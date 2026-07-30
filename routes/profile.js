const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../database/db');
const { requireAuth } = require('../middleware/authCheck');

// ⚠️ ВАЖНО: аватарки сохраняем в постоянную папку
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const DEFAULT_AVATAR = '/img/default-avatar.png';

// Загрузка аватарки
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, AVATAR_DIR);
    },
    filename: (req, file, cb) => {
        // Уникальное имя: user_ID_timestamp.ext
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const filename = `user_${req.session.userId}_${Date.now()}${ext}`;
        cb(null, filename);
    }
});

const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Только фото (JPG, PNG, WEBP), без гифок'));
    }
});

// ==================== СМЕНА ПАРОЛЯ ====================
router.post('/change-password', requireAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;

        if (!oldPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }
        if (newPassword.length > 32) {
            return res.status(400).json({ error: 'Пароль слишком длинный' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Пароли не совпадают' });
        }

        const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
        const valid = await bcrypt.compare(oldPassword, user.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Старый пароль неверный' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.userId]);
        res.json({ success: true, message: 'Пароль изменён' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ЗАПРОС НА СМЕНУ СЕКРЕТНОГО СЛОВА ====================
router.post('/request-secret-change', requireAuth, async (req, res) => {
    try {
        const { password, newSecret } = req.body;

        const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        const u = user.rows[0];

        if (u.secret_change_blocked) {
            return res.status(403).json({ error: 'Смена секретного слова заблокирована навсегда' });
        }

        const valid = await bcrypt.compare(password, u.password_hash);
        if (!valid) return res.status(401).json({ error: 'Неверный пароль' });

        if (!newSecret || newSecret.length > 32 || newSecret.length < 1) {
            return res.status(400).json({ error: 'Некорректное секретное слово' });
        }

        const hash = await bcrypt.hash(newSecret.toLowerCase(), 10);
        await pool.query(`
            UPDATE users 
            SET secret_change_pending = NOW() + INTERVAL '24 hours',
                pending_new_secret = $1
            WHERE id = $2
        `, [hash, req.session.userId]);

        res.json({ 
            success: true, 
            message: 'Смена запланирована через 24 часа. Можно отменить в настройках.',
            applyAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ОТМЕНИТЬ СМЕНУ СЕКРЕТКИ ====================
router.post('/cancel-secret-change', requireAuth, async (req, res) => {
    await pool.query(`
        UPDATE users SET secret_change_pending = NULL, pending_new_secret = NULL
        WHERE id = $1
    `, [req.session.userId]);
    res.json({ success: true, message: 'Смена секретного слова отменена' });
});

// ==================== ЗАБЛОКИРОВАТЬ СМЕНУ СЕКРЕТКИ НАВСЕГДА ====================
router.post('/block-secret-change', requireAuth, async (req, res) => {
    await pool.query(`
        UPDATE users 
        SET secret_change_blocked = TRUE, 
            secret_change_pending = NULL, 
            pending_new_secret = NULL
        WHERE id = $1
    `, [req.session.userId]);
    res.json({ success: true, message: 'Смена секретного слова заблокирована навсегда' });
});

// ==================== ПРИМЕНИТЬ ОТЛОЖЕННУЮ СМЕНУ ====================
router.post('/apply-pending-secret', requireAuth, async (req, res) => {
    const u = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = u.rows[0];
    
    if (!user.secret_change_pending || !user.pending_new_secret) {
        return res.status(400).json({ error: 'Нет отложенной смены' });
    }
    
    if (new Date(user.secret_change_pending) > new Date()) {
        return res.status(400).json({ error: 'Ещё не прошло 24 часа' });
    }
    
    await pool.query(`
        UPDATE users 
        SET secret_word_hash = pending_new_secret,
            pending_new_secret = NULL,
            secret_change_pending = NULL
        WHERE id = $1
    `, [req.session.userId]);
    
    res.json({ success: true, message: 'Секретное слово обновлено' });
});

// ==================== ЗАГРУЗКА АВАТАРКИ ====================
router.post('/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
        
        // Получаем старую аватарку чтобы удалить (если она не дефолтная)
        const old = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.session.userId]);
        const oldAvatar = old.rows[0]?.avatar;
        
        // Новый URL — всегда через /uploads/avatars/
        const newAvatarUrl = '/uploads/avatars/' + req.file.filename;
        
        // Обновляем в базе
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [newAvatarUrl, req.session.userId]);
        
        // Удаляем старую аватарку (если это была не дефолтная)
        if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/') && oldAvatar !== newAvatarUrl) {
            const oldPath = path.join(__dirname, '..', oldAvatar);
            fs.unlink(oldPath, (err) => {
                if (err) console.log('Не удалось удалить старую аватарку:', err.message);
            });
        }
        
        res.json({ success: true, avatar: newAvatarUrl });
    } catch (err) {
        console.error('Ошибка загрузки аватара:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== СБРОС АВАТАРКИ НА ДЕФОЛТНУЮ ====================
router.post('/reset-avatar', requireAuth, async (req, res) => {
    try {
        // Получаем текущую аватарку
        const cur = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.session.userId]);
        const currentAvatar = cur.rows[0]?.avatar;
        
        // Устанавливаем дефолтную
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [DEFAULT_AVATAR, req.session.userId]);
        
        // Удаляем старый файл если это была загруженная аватарка
        if (currentAvatar && currentAvatar.startsWith('/uploads/avatars/')) {
            const oldPath = path.join(__dirname, '..', currentAvatar);
            fs.unlink(oldPath, (err) => {
                if (err) console.log('Не удалось удалить файл аватара:', err.message);
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Аватарка сброшена на дефолтную',
            avatar: DEFAULT_AVATAR
        });
    } catch (err) {
        console.error('Ошибка сброса аватара:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== НАСТРОЙКИ ТЕМЫ ====================
router.post('/theme', requireAuth, async (req, res) => {
    const { theme, customColor } = req.body;
    await pool.query(
        'UPDATE users SET theme = $1, custom_color = $2 WHERE id = $3',
        [theme || 'light', customColor || null, req.session.userId]
    );
    res.json({ success: true });
});

// ==================== ПОЛУЧИТЬ ИНФО О ПРОФИЛЕ ====================
router.get('/info', requireAuth, async (req, res) => {
    const r = await pool.query(`
        SELECT id, unique_id, email, avatar, theme, custom_color, 
               is_admin, secret_change_blocked, secret_change_pending, created_at
        FROM users WHERE id = $1
    `, [req.session.userId]);
    
    const u = r.rows[0];
    res.json({
        id: u.id,
        uniqueId: u.unique_id,
        email: u.email + '@minzdrav.ru',
        avatar: u.avatar || DEFAULT_AVATAR,
        theme: u.theme,
        customColor: u.custom_color,
        isAdmin: u.is_admin,
        secretBlocked: u.secret_change_blocked,
        secretPending: u.secret_change_pending,
        createdAt: u.created_at
    });
});

module.exports = router;
