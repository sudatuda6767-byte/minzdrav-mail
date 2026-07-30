const { Pool } = require('pg');
require('dotenv').config();

// Подключение к PostgreSQL (Render даёт URL автоматически)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: false } 
        : false
});

// Функция создания всех таблиц при первом запуске
async function initDatabase() {
    const client = await pool.connect();
    try {
        // Таблица пользователей
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                unique_id VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(50) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                secret_word_hash TEXT NOT NULL,
                avatar VARCHAR(255) DEFAULT '/img/default-avatar.svg',
                theme VARCHAR(20) DEFAULT 'light',
                custom_color VARCHAR(20) DEFAULT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                is_support BOOLEAN DEFAULT FALSE,
                secret_change_blocked BOOLEAN DEFAULT FALSE,
                secret_change_pending TIMESTAMP DEFAULT NULL,
                pending_new_secret TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Таблица писем
        await client.query(`
            CREATE TABLE IF NOT EXISTS emails (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                subject VARCHAR(255),
                body TEXT,
                folder VARCHAR(50) DEFAULT 'inbox',
                custom_folder VARCHAR(100) DEFAULT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                is_starred BOOLEAN DEFAULT FALSE,
                is_deleted BOOLEAN DEFAULT FALSE,
                is_spam BOOLEAN DEFAULT FALSE,
                is_unwanted BOOLEAN DEFAULT FALSE,
                is_draft BOOLEAN DEFAULT FALSE,
                labels TEXT DEFAULT '[]',
                sent_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Таблица вложений
        await client.query(`
            CREATE TABLE IF NOT EXISTS attachments (
                id SERIAL PRIMARY KEY,
                email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
                filename VARCHAR(255),
                filepath VARCHAR(500),
                filesize INTEGER,
                mime_type VARCHAR(100)
            )
        `);

        // Таблица получателей (для копии/скрытой копии)
        await client.query(`
            CREATE TABLE IF NOT EXISTS email_recipients (
                id SERIAL PRIMARY KEY,
                email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(20) DEFAULT 'to'
            )
        `);

        // Таблица тикетов техподдержки
        await client.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                lost_email VARCHAR(50),
                description TEXT,
                status VARCHAR(20) DEFAULT 'open',
                admin_response TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                resolved_at TIMESTAMP DEFAULT NULL
            )
        `);

        // Таблица заблокированных попыток входа
        await client.query(`
            CREATE TABLE IF NOT EXISTS login_attempts (
                id SERIAL PRIMARY KEY,
                email VARCHAR(50),
                attempts INTEGER DEFAULT 0,
                blocked_until TIMESTAMP DEFAULT NULL,
                attempt_type VARCHAR(20) DEFAULT 'password'
            )
        `);

        // Таблица пользовательских папок
        await client.query(`
            CREATE TABLE IF NOT EXISTS custom_folders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                folder_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Таблица пользователей под наблюдением (unwanted)
        await client.query(`
            CREATE TABLE IF NOT EXISTS watched_users (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                reason TEXT,
                added_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Создаём аккаунт техподдержки, если его нет
        const bcrypt = require('bcrypt');
        const supportEmail = process.env.SUPPORT_EMAIL || 'tekhnicheskaya-podderzhka-pochty';
        
        const existing = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [supportEmail]
        );

        if (existing.rows.length === 0) {
            const passwordHash = await bcrypt.hash(
                process.env.SUPPORT_PASSWORD || 'MinZdrav@Support#2024!Secure',
                10
            );
            const secretHash = await bcrypt.hash(
                process.env.SUPPORT_SECRET || 'администраторпочтыминздрав2024',
                10
            );
            const uniqueId = generateUniqueId();

            await client.query(`
                INSERT INTO users (unique_id, email, password_hash, secret_word_hash, is_admin, is_support)
                VALUES ($1, $2, $3, $4, TRUE, TRUE)
            `, [uniqueId, supportEmail, passwordHash, secretHash]);

            console.log('✅ Аккаунт техподдержки создан:');
            console.log(`   📧 ${supportEmail}@minzdrav.ru`);
            console.log(`   🆔 ID: ${uniqueId}`);
        }

    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
        throw err;
    } finally {
        client.release();
    }
}

// Генератор уникальных ID (формат: 7цифр-6букв/цифр-6букв/цифр)
function generateUniqueId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const nums = '0123456789';
    
    let part1 = '';
    for (let i = 0; i < 7; i++) part1 += nums[Math.floor(Math.random() * 10)];
    
    let part2 = '';
    for (let i = 0; i < 6; i++) part2 += chars[Math.floor(Math.random() * chars.length)];
    
    let part3 = '';
    for (let i = 0; i < 6; i++) part3 += chars[Math.floor(Math.random() * chars.length)];
    
    return `${part1}-${part2}-${part3}`;
}

module.exports = { pool, initDatabase, generateUniqueId };
