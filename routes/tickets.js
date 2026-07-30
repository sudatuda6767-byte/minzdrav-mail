const express = require('express');
const router = express.Router();
const { pool } = require('../database/db');
const { requireAuth } = require('../middleware/authCheck');

// ==================== СОЗДАТЬ ТИКЕТ (без авторизации - для страницы /ticket) ====================
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

// ==================== СОЗДАТЬ ТИКЕТ ИЗ ПОЧТЫ (авторизованный пользователь) ====================
router.post('/create-from-mail', requireAuth, async (req, res) => {
    try {
        const { subject, description } = req.body;

        if (!subject || !description) {
            return res.status(400).json({ error: 'Заполните все поля (тема и описание)' });
        }

        if (description.length < 10) {
            return res.status(400).json({ error: 'Опишите проблему подробнее (минимум 10 символов)' });
        }

        // Получаем email автора тикета
        const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.session.userId]);
        const userEmail = userResult.rows[0].email;

        // Формируем полное описание: тема + текст + автор
        const fullDescription = `📋 ТЕМА: ${subject}\n\n📝 ОПИСАНИЕ:\n${description}\n\n👤 От пользователя: ${userEmail}@minzdrav.ru`;

        const result = await pool.query(`
            INSERT INTO tickets (lost_email, description, status)
            VALUES ($1, $2, 'open')
            RETURNING id
        `, [userEmail, fullDescription]);

        res.json({ 
            success: true, 
            ticketId: result.rows[0].id,
            message: `Обращение №${result.rows[0].id} создано! Техподдержка ответит вам в ближайшее время.`
        });

    } catch (err) {
        console.error('Ошибка создания тикета:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;
