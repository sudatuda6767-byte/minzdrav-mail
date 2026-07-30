// Проверка что пользователь авторизован
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

// Проверка что пользователь — админ/техподдержка
function requireAdmin(req, res, next) {
    if (!req.session.userId || !req.session.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    next();
}

module.exports = { requireAuth, requireAdmin };
