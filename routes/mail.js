const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../database/db');
const { requireAuth } = require('../middleware/authCheck');

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/attachments';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 МБ
});

// ==================== ОТПРАВИТЬ ПИСЬМО ====================
router.post('/send', requireAuth, upload.array('attachments', 5), async (req, res) => {
    try {
        const { to, cc, bcc, subject, body, isDraft } = req.body;
        const senderId = req.session.userId;

        if (!to && !isDraft) {
            return res.status(400).json({ error: 'Укажите получателя' });
        }

        // Парсим получателей
        const parseRecipients = (str) => {
            if (!str) return [];
            return str.split(',').map(e => e.trim().toLowerCase().replace('@minzdrav.ru', '')).filter(Boolean);
        };

        const toList = parseRecipients(to);
        const ccList = parseRecipients(cc);
        const bccList = parseRecipients(bcc);
        const allRecipients = [...toList, ...ccList, ...bccList];

        // Черновик — сохраняем без получателей
        if (isDraft === 'true' || isDraft === true) {
            const result = await pool.query(`
                INSERT INTO emails (sender_id, recipient_id, subject, body, is_draft, folder)
                VALUES ($1, $1, $2, $3, TRUE, 'drafts')
                RETURNING id
            `, [senderId, subject || '(Без темы)', body || '']);

            // Сохраняем вложения
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    await pool.query(`
                        INSERT INTO attachments (email_id, filename, filepath, filesize, mime_type)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [result.rows[0].id, file.originalname, file.path, file.size, file.mimetype]);
                }
            }

            return res.json({ success: true, draftId: result.rows[0].id });
        }

        // Проверяем существование получателей
        const recipientData = [];
        for (const email of allRecipients) {
            const r = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (r.rows.length === 0) {
                return res.status(400).json({ error: `Получатель ${email}@minzdrav.ru не существует` });
            }
            recipientData.push({ email, id: r.rows[0].id });
        }

        // Проверяем, находится ли отправитель под наблюдением
        const watchCheck = await pool.query('SELECT id FROM watched_users WHERE user_id = $1', [senderId]);
        const isUnwanted = watchCheck.rows.length > 0;

        // Отправляем письмо каждому получателю
        const sentEmails = [];
        for (const recipient of recipientData) {
            const type = toList.includes(recipient.email) ? 'to' : 
                        (ccList.includes(recipient.email) ? 'cc' : 'bcc');

            const result = await pool.query(`
                INSERT INTO emails (sender_id, recipient_id, subject, body, folder, is_unwanted)
                VALUES ($1, $2, $3, $4, 'inbox', $5)
                RETURNING id
            `, [senderId, recipient.id, subject || '(Без темы)', body || '', isUnwanted]);

            const emailId = result.rows[0].id;
            sentEmails.push(emailId);

            await pool.query(`
                INSERT INTO email_recipients (email_id, recipient_id, type)
                VALUES ($1, $2, $3)
            `, [emailId, recipient.id, type]);

            // Сохраняем вложения (копия для каждого)
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    await pool.query(`
                        INSERT INTO attachments (email_id, filename, filepath, filesize, mime_type)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [emailId, file.originalname, file.path, file.size, file.mimetype]);
                }
            }

            // Уведомление через WebSocket
            req.io.to(`user_${recipient.id}`).emit('new-email', {
                from: req.session.email + '@minzdrav.ru',
                subject: subject || '(Без темы)'
            });
        }

        // Сохраняем копию в "Отправленные" у отправителя
        const sentCopy = await pool.query(`
            INSERT INTO emails (sender_id, recipient_id, subject, body, folder)
            VALUES ($1, $1, $2, $3, 'sent')
            RETURNING id
        `, [senderId, subject || '(Без темы)', body || '']);

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.query(`
                    INSERT INTO attachments (email_id, filename, filepath, filesize, mime_type)
                    VALUES ($1, $2, $3, $4, $5)
                `, [sentCopy.rows[0].id, file.originalname, file.path, file.size, file.mimetype]);
            }
        }

        res.json({ success: true, sent: sentEmails.length });

    } catch (err) {
        console.error('Ошибка отправки:', err);
        res.status(500).json({ error: 'Ошибка отправки письма' });
    }
});

// ==================== ПОЛУЧИТЬ ПИСЬМА ИЗ ПАПКИ ====================
router.get('/folder/:folder', requireAuth, async (req, res) => {
    try {
        const { folder } = req.params;
        const userId = req.session.userId;
        const { search, dateFrom, dateTo, fromUser } = req.query;

        let whereClause = '';
        let params = [userId];
        let paramIdx = 2;

        // Определяем условия для папки
        switch (folder) {
            case 'all':
                whereClause = 'e.recipient_id = $1 AND e.is_deleted = FALSE AND e.is_spam = FALSE AND e.is_draft = FALSE';
                break;
            case 'inbox':
                whereClause = 'e.recipient_id = $1 AND e.folder = \'inbox\' AND e.is_deleted = FALSE AND e.is_spam = FALSE AND e.is_unwanted = FALSE';
                break;
            case 'sent':
                whereClause = 'e.sender_id = $1 AND e.folder = \'sent\' AND e.is_deleted = FALSE';
                break;
            case 'drafts':
                whereClause = 'e.sender_id = $1 AND e.is_draft = TRUE AND e.is_deleted = FALSE';
                break;
            case 'spam':
                whereClause = 'e.recipient_id = $1 AND e.is_spam = TRUE AND e.is_deleted = FALSE';
                break;
            case 'unwanted':
                whereClause = 'e.recipient_id = $1 AND e.is_unwanted = TRUE AND e.is_deleted = FALSE';
                break;
            case 'trash':
                whereClause = '(e.recipient_id = $1 OR e.sender_id = $1) AND e.is_deleted = TRUE';
                break;
            default:
                // Кастомная папка
                whereClause = 'e.recipient_id = $1 AND e.custom_folder = $2 AND e.is_deleted = FALSE';
                params.push(folder);
                paramIdx = 3;
        }

        // Фильтры поиска
        if (search) {
            whereClause += ` AND (e.subject ILIKE $${paramIdx} OR e.body ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (dateFrom) {
            whereClause += ` AND e.sent_at >= $${paramIdx}`;
            params.push(dateFrom);
            paramIdx++;
        }
        if (dateTo) {
            whereClause += ` AND e.sent_at <= $${paramIdx}`;
            params.push(dateTo);
            paramIdx++;
        }
        if (fromUser) {
            whereClause += ` AND u.email ILIKE $${paramIdx}`;
            params.push(`%${fromUser.replace('@minzdrav.ru', '')}%`);
            paramIdx++;
        }

        const query = `
            SELECT e.*, u.email as sender_email, u.avatar as sender_avatar,
                   r.email as recipient_email
            FROM emails e
            LEFT JOIN users u ON e.sender_id = u.id
            LEFT JOIN users r ON e.recipient_id = r.id
            WHERE ${whereClause}
            ORDER BY e.sent_at DESC
            LIMIT 200
        `;

        const result = await pool.query(query, params);

        // Считаем непрочитанные
        const unreadResult = await pool.query(`
            SELECT COUNT(*) FROM emails 
            WHERE recipient_id = $1 AND is_read = FALSE AND is_deleted = FALSE AND is_draft = FALSE
        `, [userId]);

        res.json({
            emails: result.rows.map(e => ({
                id: e.id,
                from: e.sender_email + '@minzdrav.ru',
                to: e.recipient_email + '@minzdrav.ru',
                subject: e.subject,
                body: e.body,
                sentAt: e.sent_at,
                isRead: e.is_read,
                isStarred: e.is_starred,
                isSpam: e.is_spam,
                isUnwanted: e.is_unwanted,
                labels: JSON.parse(e.labels || '[]'),
                senderAvatar: e.sender_avatar
            })),
            unreadCount: parseInt(unreadResult.rows[0].count)
        });

    } catch (err) {
        console.error('Ошибка получения писем:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ПОЛУЧИТЬ ОДНО ПИСЬМО ====================
router.get('/email/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;

        const result = await pool.query(`
            SELECT e.*, u.email as sender_email, u.avatar as sender_avatar,
                   r.email as recipient_email
            FROM emails e
            LEFT JOIN users u ON e.sender_id = u.id
            LEFT JOIN users r ON e.recipient_id = r.id
            WHERE e.id = $1 AND (e.recipient_id = $2 OR e.sender_id = $2)
        `, [id, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Письмо не найдено' });
        }

        const email = result.rows[0];

        // Помечаем как прочитанное
        if (email.recipient_id === userId && !email.is_read) {
            await pool.query('UPDATE emails SET is_read = TRUE WHERE id = $1', [id]);
        }

        // Получаем вложения
        const attachments = await pool.query(
            'SELECT id, filename, filesize, mime_type FROM attachments WHERE email_id = $1',
            [id]
        );

        res.json({
            id: email.id,
            from: email.sender_email + '@minzdrav.ru',
            to: email.recipient_email + '@minzdrav.ru',
            subject: email.subject,
            body: email.body,
            sentAt: email.sent_at,
            isRead: true,
            isStarred: email.is_starred,
            isUnwanted: email.is_unwanted,
            labels: JSON.parse(email.labels || '[]'),
            senderAvatar: email.sender_avatar,
            attachments: attachments.rows
        });

    } catch (err) {
        console.error('Ошибка получения письма:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== СКАЧАТЬ ВЛОЖЕНИЕ ====================
router.get('/attachment/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, e.recipient_id, e.sender_id 
            FROM attachments a 
            JOIN emails e ON a.email_id = e.id 
            WHERE a.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        const att = result.rows[0];
        if (att.recipient_id !== req.session.userId && att.sender_id !== req.session.userId) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        res.download(att.filepath, att.filename);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка скачивания' });
    }
});

// ==================== ДЕЙСТВИЯ С ПИСЬМОМ ====================
router.post('/action', requireAuth, async (req, res) => {
    try {
        const { emailIds, action, value } = req.body;
        const userId = req.session.userId;

        if (!Array.isArray(emailIds) || emailIds.length === 0) {
            return res.status(400).json({ error: 'Не выбраны письма' });
        }

        const ids = emailIds.map(Number);
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');

        switch (action) {
            case 'read':
                await pool.query(
                    `UPDATE emails SET is_read = TRUE WHERE recipient_id = $1 AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'unread':
                await pool.query(
                    `UPDATE emails SET is_read = FALSE WHERE recipient_id = $1 AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'star':
                await pool.query(
                    `UPDATE emails SET is_starred = TRUE WHERE (recipient_id = $1 OR sender_id = $1) AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'unstar':
                await pool.query(
                    `UPDATE emails SET is_starred = FALSE WHERE (recipient_id = $1 OR sender_id = $1) AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'spam':
                await pool.query(
                    `UPDATE emails SET is_spam = TRUE WHERE recipient_id = $1 AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'unspam':
                await pool.query(
                    `UPDATE emails SET is_spam = FALSE WHERE recipient_id = $1 AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'delete':
                await pool.query(
                    `UPDATE emails SET is_deleted = TRUE WHERE (recipient_id = $1 OR sender_id = $1) AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'restore':
                await pool.query(
                    `UPDATE emails SET is_deleted = FALSE WHERE (recipient_id = $1 OR sender_id = $1) AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'delete-forever':
                await pool.query(
                    `DELETE FROM emails WHERE (recipient_id = $1 OR sender_id = $1) AND id IN (${placeholders})`,
                    [userId, ...ids]
                );
                break;
            case 'move-to-folder':
                await pool.query(
                    `UPDATE emails SET custom_folder = $${ids.length + 2} WHERE recipient_id = $1 AND id IN (${placeholders})`,
                    [userId, ...ids, value]
                );
                break;
            case 'label':
                for (const id of ids) {
                    const cur = await pool.query('SELECT labels FROM emails WHERE id = $1 AND (recipient_id = $2 OR sender_id = $2)', [id, userId]);
                    if (cur.rows.length > 0) {
                        let labels = JSON.parse(cur.rows[0].labels || '[]');
                        if (!labels.includes(value)) labels.push(value);
                        await pool.query('UPDATE emails SET labels = $1 WHERE id = $2', [JSON.stringify(labels), id]);
                    }
                }
                break;
            case 'unlabel':
                for (const id of ids) {
                    const cur = await pool.query('SELECT labels FROM emails WHERE id = $1 AND (recipient_id = $2 OR sender_id = $2)', [id, userId]);
                    if (cur.rows.length > 0) {
                        let labels = JSON.parse(cur.rows[0].labels || '[]');
                        labels = labels.filter(l => l !== value);
                        await pool.query('UPDATE emails SET labels = $1 WHERE id = $2', [JSON.stringify(labels), id]);
                    }
                }
                break;
            default:
                return res.status(400).json({ error: 'Неизвестное действие' });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Ошибка действия:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== КАСТОМНЫЕ ПАПКИ ====================
router.get('/folders', requireAuth, async (req, res) => {
    const result = await pool.query(
        'SELECT * FROM custom_folders WHERE user_id = $1 ORDER BY created_at',
        [req.session.userId]
    );
    res.json({ folders: result.rows });
});

router.post('/folders', requireAuth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.length > 50) {
            return res.status(400).json({ error: 'Некорректное название папки' });
        }
        await pool.query(
            'INSERT INTO custom_folders (user_id, folder_name) VALUES ($1, $2)',
            [req.session.userId, name]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания папки' });
    }
});

router.delete('/folders/:id', requireAuth, async (req, res) => {
    await pool.query(
        'DELETE FROM custom_folders WHERE id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
    );
    res.json({ success: true });
});

module.exports = router;
