// ==================== ПОДКЛЮЧЕНИЕ БИБЛИОТЕК ====================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const pgSession = require('connect-pg-simple')(session);

// Подключение к базе данных
const { pool, initDatabase } = require('./database/db');

// ==================== СОЗДАНИЕ ПРИЛОЖЕНИЯ ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ==================== НАСТРОЙКИ ====================
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== ПОДКЛЮЧЕНИЕ БИБЛИОТЕК ====================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const pgSession = require('connect-pg-simple')(session);

const { pool, initDatabase } = require('./database/db');

// ==================== СОЗДАНИЕ ПРИЛОЖЕНИЯ ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ⚠️ ВАЖНО для Render: доверять прокси (для https и cookies)
app.set('trust proxy', 1);

// ==================== НАСТРОЙКИ ====================
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка сессий (авторизация)
const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'user_sessions',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'change_me_secret_key_123',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
        httpOnly: true,
        secure: isProduction,       // HTTPS только в проде
        sameSite: isProduction ? 'lax' : 'lax'
    }
}));

// Передача io в маршруты
app.use((req, res, next) => {
    req.io = io;
    next();
});

// ==================== МАРШРУТЫ API ====================
const authRoutes = require('./routes/auth');
const mailRoutes = require('./routes/mail');
const ticketRoutes = require('./routes/tickets');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');

app.use('/api/auth', authRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);

// ==================== СТРАНИЦЫ ====================
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/mail');
    }
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/register.html'));
});

app.get('/recovery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/recovery.html'));
});

app.get('/ticket', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/ticket.html'));
});

app.get('/mail', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/mailbox.html'));
});

app.get('/settings', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/settings.html'));
});

app.get('/admin', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
});

// ==================== WEB-SOCKET ====================
io.on('connection', (socket) => {
    console.log('🟢 Пользователь подключился');
    
    socket.on('register-user', (userId) => {
        socket.join(`user_${userId}`);
    });
    
    socket.on('disconnect', () => {
        console.log('🔴 Пользователь отключился');
    });
});

// ==================== ЗАПУСК ====================
async function startServer() {
    try {
        await initDatabase();
        console.log('✅ База данных готова');
        
        server.listen(PORT, () => {
            console.log('╔════════════════════════════════════════╗');
            console.log('║   🏥 MINZDRAV.RU MAIL SERVER          ║');
            console.log(`║   🚀 Запущен на порту: ${PORT}         ║`);
            console.log('╚════════════════════════════════════════╝');
        });
    } catch (err) {
        console.error('❌ Ошибка запуска:', err);
        process.exit(1);
    }
}

startServer();
// ==================== МАРШРУТЫ API ====================
const authRoutes = require('./routes/auth');
const mailRoutes = require('./routes/mail');
const ticketRoutes = require('./routes/tickets');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');

app.use('/api/auth', authRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);

// ==================== СТРАНИЦЫ ====================
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/mail');
    }
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/register.html'));
});

app.get('/recovery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/recovery.html'));
});

app.get('/ticket', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/ticket.html'));
});

app.get('/mail', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/mailbox.html'));
});

app.get('/settings', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/settings.html'));
});

app.get('/admin', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
});

// ==================== WEB-SOCKET ====================
io.on('connection', (socket) => {
    console.log('🟢 Пользователь подключился');
    
    socket.on('register-user', (userId) => {
        socket.join(`user_${userId}`);
    });
    
    socket.on('disconnect', () => {
        console.log('🔴 Пользователь отключился');
    });
});

// ==================== ЗАПУСК ====================
async function startServer() {
    try {
        await initDatabase();
        console.log('✅ База данных готова');
        
        server.listen(PORT, () => {
            console.log('╔════════════════════════════════════════╗');
            console.log('║   🏥 MINZDRAV.RU MAIL SERVER          ║');
            console.log(`║   🚀 Запущен на порту: ${PORT}         ║`);
            console.log('╚════════════════════════════════════════╝');
        });
    } catch (err) {
        console.error('❌ Ошибка запуска:', err);
        process.exit(1);
    }
}

startServer();
