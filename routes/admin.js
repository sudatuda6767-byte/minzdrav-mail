const express = require('express');
const router = express.Router();
const { pool } = require('../database/db');
const { requireAdmin } = require('../middleware/authCheck');

// ==================== СПИСОК ТИКЕТОВ ====================
router.get('/tickets', requireAdmin, async (req, res) => {
    const result = await pool.query(`
        SELECT * FROM tickets ORDER BY created_at DESC
    `);
    res.json({ tickets: result.rows });
});

// ==================== ОТВЕТИТЬ НА ТИКЕТ ====================
router.post('/tickets/:id/respond', requireAdmin, async (req, res) => {
    try {
        const { response, status } = req.body;
        await pool.query(`
            UPDATE tickets 
            SET admin_response = $1, status = $2, resolved_at = NOW()
            WHERE id = $3
        `, [response, status || 'resolved', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==================== СПИСОК ПОЛЬЗОВАТЕЛЕЙ ====================
router.get('/users', requireAdmin, async (req, res) => {
    const result = await pool.query(`
        SELECT u.id, u.unique_id, u.email, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM watched_users WHERE user_id = u.id) as watched,
        (SELECT reason FROM watched_users WHERE user_id = u.id LIMIT 1) as watch_reason,
        (SELECT added_at FROM watched_users WHERE user_id = u.id LIMIT 1) as watch_added_at
        FROM users u ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
});

// ==================== ДОБАВИТЬ ПОЛЬЗОВАТЕЛЯ В "ПОД НАБЛЮДЕНИЕ" ПО ID ====================
router.post('/watch-user', requireAdmin, async (req, res) => {
    try {
        const { userId, reason } = req.body;
        await pool.query(`
            INSERT INTO watched_users (user_id, reason)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET reason = $2
        `, [userId, reason || 'Без причины']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==================== ДОБАВИТЬ ПОЛЬЗОВАТЕЛЯ ПО EMAIL ====================
router.post('/watch-user-by-email', requireAdmin, async (req, res) => {
    try {
        let { email, reason } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Укажите почту' });
        }
        
        // Убираем @minzdrav.ru если есть
        email = email.toLowerCase().trim().replace('@minzdrav.ru', '');
        
        // Ищем пользователя
        const userResult = await pool.query('SELECT id, email, is_admin FROM users WHERE email = $1', [email]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: `Пользователь ${email}@minzdrav.ru не найден` });
        }
        
        const user = userResult.rows[0];
        
        // Нельзя наблюдать за админом
        if (user.is_admin) {
            return res.status(400).json({ error: 'Нельзя добавить администратора под наблюдение' });
        }
        
        // Проверяем не под наблюдением ли уже
        const existing = await pool.query('SELECT id FROM watched_users WHERE user_id = $1', [user.id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: `${email}@minzdrav.ru уже находится под наблюдением` });
        }
        
        // Добавляем
        await pool.query(`
            INSERT INTO watched_users (user_id, reason)
            VALUES ($1, $2)
        `, [user.id, reason || 'Без указания причины']);
        
        res.json({ 
            success: true, 
            message: `${email}@minzdrav.ru добавлен под наблюдение. Все его будущие письма получателям будут помечаться как "Нежелательные".`
        });
        
    } catch (err) {
        console.error('Ошибка добавления под наблюдение:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== СНЯТЬ НАБЛЮДЕНИЕ ====================
router.post('/unwatch-user', requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM watched_users WHERE user_id = $1', [req.body.userId]);
    res.json({ success: true });
});

// ==================== СПИСОК ТОЛЬКО ПОД НАБЛЮДЕНИЕМ (детально) ====================
router.get('/watched', requireAdmin, async (req, res) => {
    const result = await pool.query(`
        SELECT w.id as watch_id, w.reason, w.added_at,
               u.id as user_id, u.unique_id, u.email, u.created_at
        FROM watched_users w
        JOIN users u ON w.user_id = u.id
        ORDER BY w.added_at DESC
    `);
    res.json({ watched: result.rows });
});

// ==================== СБРОС ПАРОЛЯ ПОЛЬЗОВАТЕЛЮ ====================
router.post('/reset-user-password', requireAdmin, async (req, res) => {
    try {
        const bcrypt = require('bcrypt');
        const { userId, newPassword } = req.body;
        
        if (!newPassword || newPassword.length > 32) {
            return res.status(400).json({ error: 'Некорректный пароль' });
        }
        
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

module.exports = router;
