const express = require('express');
const router = express.Router();
const { pool } = require('../database/db');

// ==================== СОЗДАТЬ ТИКЕТ (без авторизации!) ====================
router.post('/create', async (req, res) => {
    try {
        const { lostEmail, description } = req.body;

        if (!lostEmail || !description) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        if (description.length < 20) {
            return res.status(400).json({ error: 'Опишите ситуацию подробнее (минимум 20 символов)' });
        }

        const email = lostEmail.toLowerCase().trim().replace('@minzdrav.ru', '');

        const result = await pool.query(`
            INSERT INTO tickets (lost_email, description, status)
            VALUES ($1, $2, 'open')
            RETURNING id
        `, [email, description]);

        res.json({ 
            success: true, 
            ticketId: result.rows[0].id,
            message: 'Тикет создан! С вами свяжется техническая поддержка.'
        });

    } catch (err) {
        console.error('Ошибка создания тикета:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;
