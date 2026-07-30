const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { pool, generateUniqueId } = require('../database/db');

// ==================== СПИСОК ЗАПРЕЩЁННЫХ ИМЁН ====================
const RESERVED_NAMES = [
    'admin', 'support', 'root', 'tekhnicheskaya-podderzhka-pochty',
    'administrator', 'moderator', 'system', 'noreply', 'postmaster'
];

// ==================== ВАЛИДАЦИЯ ПОЧТЫ ====================
function validateEmail(email) {
    if (!email) return 'Введите название почты';
    if (email.length > 32) return 'Название почты слишком длинное';
    if (email.length < 3) return 'Название почты слишком короткое (минимум 3 символа)';
    if (!/^[a-z0-9]+$/.test(email)) {
        return 'Разрешены только английские буквы (маленькие) и цифры без пробелов и символов';
    }
    if (RESERVED_NAMES.includes(email.toLowerCase())) {
        return 'Это имя зарезервировано системой';
    }
    return null;
}

// ==================== РЕГИСТРАЦИЯ ====================
router.post('/register', async (req, res) => {
    try {
        let { email, password, confirmPassword, secretWord } = req.body;

        if (!email || !password || !confirmPassword || !secretWord) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        email = email.toLowerCase().trim();

        // Валидация почты
        const emailError = validateEmail(email);
        if (emailError) return res.status(400).json({ error: emailError });

        // Проверка пароля
        if (password.length > 32) {
            return res.status(400).json({ error: 'Пароль слишком длинный (макс. 32 символа)' });
        }
        if (password.length < 1) {
            return res.status(400).json({ error: 'Введите пароль' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Пароли не совпадают' });
        }

        // Проверка секретного слова
        if (secretWord.length > 32) {
            return res.status(400).json({ error: 'Секретное слово слишком длинное (макс. 32 символа)' });
        }
        if (secretWord.length < 1) {
            return res.status(400).json({ error: 'Введите секретное слово' });
        }

        // Проверка что почта не занята
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Такая почта уже занята' });
        }

        // Хешируем пароль и секретку
        const passwordHash = await bcrypt.hash(password, 10);
        const secretHash = await bcrypt.hash(secretWord.toLowerCase(), 10);

        // Генерируем уникальный ID
        let uniqueId;
        let isUnique = false;
        while (!isUnique) {
            uniqueId = generateUniqueId();
            const check = await pool.query('SELECT id FROM users WHERE unique_id = $1', [uniqueId]);
            if (check.rows.length === 0) isUnique = true;
        }

        // Создаём пользователя
        const result = await pool.query(`
            INSERT INTO users (unique_id, email, password_hash, secret_word_hash)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, unique_id
        `, [uniqueId, email, passwordHash, secretHash]);

        const user = result.rows[0];

        // Автоматически логиним
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.uniqueId = user.unique_id;
        req.session.isAdmin = false;

        res.json({
            success: true,
            message: 'Регистрация успешна!',
            user: {
                email: user.email + '@minzdrav.ru',
                uniqueId: user.unique_id
            }
        });

    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ВХОД ====================
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        // Убираем @minzdrav.ru если ввели полностью
        email = email.toLowerCase().trim().replace('@minzdrav.ru', '');

        // Проверка блокировки
        const blockCheck = await pool.query(`
            SELECT * FROM login_attempts 
            WHERE email = $1 AND attempt_type = 'password' AND blocked_until > NOW()
        `, [email]);

        if (blockCheck.rows.length > 0) {
            const unblockTime = new Date(blockCheck.rows[0].blocked_until);
            const minutesLeft = Math.ceil((unblockTime - new Date()) / 60000);
            return res.status(429).json({ 
                error: `Слишком много попыток. Попробуйте через ${minutesLeft} мин.` 
            });
        }

        // Поиск пользователя
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Неверная почта или пароль' });
        }

        const user = result.rows[0];

        // Проверка пароля
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            // Увеличиваем счётчик попыток
            const attemptResult = await pool.query(`
                INSERT INTO login_attempts (email, attempts, attempt_type)
                VALUES ($1, 1, 'password')
                ON CONFLICT DO NOTHING
                RETURNING *
            `, [email]);

            let attempts = 1;
            if (attemptResult.rows.length === 0) {
                const upd = await pool.query(`
                    UPDATE login_attempts 
                    SET attempts = attempts + 1 
                    WHERE email = $1 AND attempt_type = 'password'
                    RETURNING attempts
                `, [email]);
                attempts = upd.rows[0]?.attempts || 1;
            }

            if (attempts >= 3) {
                await pool.query(`
                    UPDATE login_attempts 
                    SET blocked_until = NOW() + INTERVAL '10 minutes', attempts = 0
                    WHERE email = $1 AND attempt_type = 'password'
                `, [email]);
                return res.status(429).json({ 
                    error: 'Слишком много попыток. Заблокировано на 10 минут.' 
                });
            }

            return res.status(401).json({ 
                error: `Неверная почта или пароль. Осталось попыток: ${3 - attempts}` 
            });
        }

        // Сбрасываем счётчик попыток при успехе
        await pool.query(`
            DELETE FROM login_attempts WHERE email = $1 AND attempt_type = 'password'
        `, [email]);

        // Создаём сессию
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.uniqueId = user.unique_id;
        req.session.isAdmin = user.is_admin;

        res.json({
            success: true,
            user: {
                email: user.email + '@minzdrav.ru',
                uniqueId: user.unique_id,
                isAdmin: user.is_admin
            }
        });

    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ВОССТАНОВЛЕНИЕ ЧЕРЕЗ СЕКРЕТНОЕ СЛОВО ====================
router.post('/recovery', async (req, res) => {
    try {
        let { email, secretWord } = req.body;

        if (!email || !secretWord) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        email = email.toLowerCase().trim().replace('@minzdrav.ru', '');

        // Проверка блокировки секретки
        const blockCheck = await pool.query(`
            SELECT * FROM login_attempts 
            WHERE email = $1 AND attempt_type = 'secret' AND blocked_until > NOW()
        `, [email]);

        if (blockCheck.rows.length > 0) {
            const unblockTime = new Date(blockCheck.rows[0].blocked_until);
            const minutesLeft = Math.ceil((unblockTime - new Date()) / 60000);
            return res.status(429).json({ 
                error: `Слишком много попыток. Попробуйте через ${minutesLeft} мин.`,
                showTicket: true
            });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Неверная почта или секретное слово' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(secretWord.toLowerCase(), user.secret_word_hash);

        if (!valid) {
            // Счётчик попыток
            await pool.query(`
                INSERT INTO login_attempts (email, attempts, attempt_type)
                VALUES ($1, 1, 'secret')
                ON CONFLICT DO NOTHING
            `, [email]);

            const upd = await pool.query(`
                UPDATE login_attempts 
                SET attempts = attempts + 1 
                WHERE email = $1 AND attempt_type = 'secret'
                RETURNING attempts
            `, [email]);
            const attempts = upd.rows[0]?.attempts || 1;

            if (attempts >= 3) {
                await pool.query(`
                    UPDATE login_attempts 
                    SET blocked_until = NOW() + INTERVAL '30 minutes', attempts = 0
                    WHERE email = $1 AND attempt_type = 'secret'
                `, [email]);
                return res.status(429).json({ 
                    error: 'Слишком много попыток. Заблокировано на 30 минут.',
                    showTicket: true
                });
            }

            return res.status(401).json({ 
                error: `Неверное секретное слово. Осталось попыток: ${3 - attempts}` 
            });
        }

        // Сбрасываем счётчик
        await pool.query(`
            DELETE FROM login_attempts WHERE email = $1 AND attempt_type = 'secret'
        `, [email]);

        // Логиним
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.uniqueId = user.unique_id;
        req.session.isAdmin = user.is_admin;

        res.json({
            success: true,
            message: 'Доступ восстановлен! Рекомендуем сменить пароль в настройках.',
            user: {
                email: user.email + '@minzdrav.ru',
                uniqueId: user.unique_id
            }
        });

    } catch (err) {
        console.error('Ошибка восстановления:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== ВЫХОД ====================
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ==================== ПРОВЕРКА СЕССИИ ====================
router.get('/me', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ authorized: false });
    }
    
    const result = await pool.query(
        'SELECT id, email, unique_id, avatar, theme, custom_color, is_admin FROM users WHERE id = $1',
        [req.session.userId]
    );
    
    if (result.rows.length === 0) {
        req.session.destroy();
        return res.status(401).json({ authorized: false });
    }
    
    const user = result.rows[0];
    res.json({
        authorized: true,
        user: {
            id: user.id,
            email: user.email + '@minzdrav.ru',
            uniqueId: user.unique_id,
            avatar: user.avatar,
            theme: user.theme,
            customColor: user.custom_color,
            isAdmin: user.is_admin
        }
    });
});

module.exports = router;
