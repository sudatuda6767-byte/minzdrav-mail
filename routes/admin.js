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
        SELECT id, unique_id, email, is_admin, created_at,
        (SELECT COUNT(*) FROM watched_users WHERE user_id = users.id) as watched
        FROM users ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
});

// ==================== ДОБАВИТЬ ПОЛЬЗОВАТЕЛЯ В "ПОД НАБЛЮДЕНИЕ" ====================
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

router.post('/unwatch-user', requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM watched_users WHERE user_id = $1', [req.body.userId]);
    res.json({ success: true });
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
