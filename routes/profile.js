const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../database/db');
const { requireAuth } = require('../middleware/authCheck');
const cloudinary = require('cloudinary').v2;

// ⭐ Настройка Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMzQjgyRjYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxMEI5ODEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iMzgiIHI9IjE0IiBmaWxsPSJ3aGl0ZSIgb3BhY2l0eT0iMC45Ii8+PHBhdGggZD0iTSAyMCA5MCBRIDIwIDY1IDUwIDY1IFEgODAgNjUgODAgOTAgWiIgZmlsbD0id2hpdGUiIG9wYWNpdHk9IjAuOSIvPjwvc3ZnPg==';

// Загрузка через memory (буфер)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Только фото (JPG, PNG, WEBP), без гифок'));
    }
});

// Функция загрузки в Cloudinary
function uploadToCloudinary(buffer, userId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'minzdrav_avatars',
                public_id: `user_${userId}`,
                overwrite: true,
                resource_type: 'image',
                transformation: [
                    { width: 400, height: 400, crop: 'fill', gravity: 'face' },
                    { quality: 'auto:good' }
                ]
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

// Функция удаления из Cloudinary
async function deleteFromCloudinary(publicId) {
    try {
        await cloudinary.uploader.destroy(publicId);
        return true;
    } catch (err) {
        console.log('Не удалось удалить из Cloudinary:', err.message);
        return false;
    }
}

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

router.post('/cancel-secret-change', requireAuth, async (req, res) => {
    await pool.query(`
        UPDATE users SET secret_change_pending = NULL, pending_new_secret = NULL
        WHERE id = $1
    `, [req.session.userId]);
    res.json({ success: true, message: 'Смена секретного слова отменена' });
});

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

// ==================== ЗАГРУЗКА АВАТАРКИ В CLOUDINARY ====================
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
        
        // Проверка что Cloudinary настроен
        if (!process.env.CLOUDINARY_CLOUD_NAME) {
            return res.status(500).json({ error: 'Cloudinary не настроен на сервере' });
        }
        
        // Загружаем в Cloudinary
        const result = await uploadToCloudinary(req.file.buffer, req.session.userId);
        const avatarUrl = result.secure_url;
        
        // Сохраняем ссылку в БД
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatarUrl, req.session.userId]);
        
        res.json({ success: true, avatar: avatarUrl });
    } catch (err) {
        console.error('Ошибка загрузки аватара:', err);
        res.status(500).json({ error: err.message || 'Ошибка загрузки' });
    }
});

// ==================== СБРОС АВАТАРКИ НА ДЕФОЛТНУЮ ====================
router.post('/reset-avatar', requireAuth, async (req, res) => {
    try {
        // Удаляем из Cloudinary
        if (process.env.CLOUDINARY_CLOUD_NAME) {
            await deleteFromCloudinary(`minzdrav_avatars/user_${req.session.userId}`);
        }
        
        // Ставим дефолтную
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [DEFAULT_AVATAR, req.session.userId]);
        
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
