let allTickets = [];
let allUsers = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Проверка что мы админ
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (!me.authorized || !me.user.isAdmin) {
        alert('Доступ запрещён');
        window.location.href = '/mail';
        return;
    }
    
    setupTabs();
    setupHandlers();
    await loadTickets();
    await loadUsers();
});

function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
        });
    });
}

function setupHandlers() {
    document.getElementById('ticketFilter').addEventListener('change', renderTickets);
    document.getElementById('userSearch').addEventListener('input', renderUsers);
}

async function loadTickets() {
    const res = await fetch('/api/admin/tickets', { credentials: 'include' });
    const data = await res.json();
    allTickets = data.tickets || [];
    renderTickets();
}

function renderTickets() {
    const filter = document.getElementById('ticketFilter').value;
    let list = allTickets;
    if (filter !== 'all') list = list.filter(t => t.status === filter);
    
    const container = document.getElementById('ticketsContainer');
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">📭 Тикетов нет</div>';
        return;
    }
    
    container.innerHTML = list.map(t => `
        <div class="ticket-card ${t.status === 'resolved' ? 'resolved' : ''}">
            <div class="ticket-header">
                <div>
                    <span class="ticket-id">Тикет #${t.id}</span>
                    <span class="ticket-status status-${t.status}">${t.status === 'open' ? 'Открыт' : 'Решён'}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    ${new Date(t.created_at).toLocaleString('ru-RU')}
                </div>
            </div>
            <div class="ticket-email">📧 Утерянная почта: ${escapeHtml(t.lost_email)}@minzdrav.ru</div>
            <div class="ticket-desc">${escapeHtml(t.description)}</div>
            ${t.admin_response ? `
                <div class="ticket-response">
                    <strong>Ответ администрации:</strong><br>${escapeHtml(t.admin_response)}
                </div>
            ` : ''}
            ${t.status === 'open' ? `
                <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
                    <button class="btn" onclick="respondTicket(${t.id})">💬 Ответить и закрыть</button>
                    <button class="btn btn-secondary" onclick="resetUserPassword('${escapeHtml(t.lost_email)}', ${t.id})">🔑 Сбросить пароль</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

async function respondTicket(ticketId) {
    const response = prompt('Ответ пользователю:');
    if (!response || response.trim().length < 5) return;
    
    const res = await fetch(`/api/admin/tickets/${ticketId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, status: 'resolved' }),
        credentials: 'include'
    });
    
    if (res.ok) {
        alert('✅ Тикет обработан');
        await loadTickets();
    }
}

async function resetUserPassword(email, ticketId) {
    const newPassword = prompt(`Новый пароль для ${email}@minzdrav.ru:\n(Сообщите его пользователю в ответе)`);
    if (!newPassword || newPassword.length > 32) return;
    
    // Найти userId по email
    const user = allUsers.find(u => u.email === email);
    if (!user) {
        // Догрузим пользователей
        await loadUsers();
        const user2 = allUsers.find(u => u.email === email);
        if (!user2) {
            alert('Пользователь не найден');
            return;
        }
    }
    
    const targetUser = allUsers.find(u => u.email === email);
    
    const res = await fetch('/api/admin/reset-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUser.id, newPassword }),
        credentials: 'include'
    });
    
    if (res.ok) {
        alert(`✅ Пароль сброшен!\nНовый пароль: ${newPassword}\nСообщите его пользователю в ответе на тикет.`);
        respondTicket(ticketId);
    } else {
        const data = await res.json();
        alert(data.error || 'Ошибка');
    }
}

async function loadUsers() {
    const res = await fetch('/api/admin/users', { credentials: 'include' });
    const data = await res.json();
    allUsers = data.users || [];
    renderUsers();
    renderWatched();
}

function renderUsers() {
    const query = document.getElementById('userSearch').value.toLowerCase();
    let list = allUsers;
    if (query) {
        list = list.filter(u => 
            u.email.includes(query) || 
            u.unique_id.toLowerCase().includes(query)
        );
    }
    
    const container = document.getElementById('usersContainer');
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Пользователи не найдены</div>';
        return;
    }
    
    container.innerHTML = list.map(u => `
        <div class="user-card">
            <div class="user-row">
                <div class="user-info">
                    <div class="user-email">${escapeHtml(u.email)}@minzdrav.ru</div>
                    <div class="user-id">ID: ${escapeHtml(u.unique_id)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                        Зарег.: ${new Date(u.created_at).toLocaleDateString('ru-RU')}
                    </div>
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${u.is_admin ? '<span class="user-badge badge-admin">🛡️ Админ</span>' : ''}
                    ${u.watched > 0 ? '<span class="user-badge badge-watched">⚠️ Под наблюдением</span>' : ''}
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${!u.is_admin && u.watched == 0 ? `<button class="btn btn-secondary" onclick="watchUser(${u.id}, '${escapeHtml(u.email)}')">⚠️ Наблюдать</button>` : ''}
                    ${u.watched > 0 ? `<button class="btn btn-secondary" onclick="unwatchUser(${u.id})">✅ Снять наблюдение</button>` : ''}
                    ${!u.is_admin ? `<button class="btn btn-secondary" onclick="adminResetPass(${u.id}, '${escapeHtml(u.email)}')">🔑 Сбросить пароль</button>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function renderWatched() {
    const watched = allUsers.filter(u => u.watched > 0);
    const container = document.getElementById('watchedContainer');
    
    if (watched.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">👍 Никто не находится под наблюдением</div>';
        return;
    }
    
    container.innerHTML = watched.map(u => `
        <div class="user-card">
            <div class="user-row">
                <div class="user-info">
                    <div class="user-email">${escapeHtml(u.email)}@minzdrav.ru</div>
                    <div class="user-id">ID: ${escapeHtml(u.unique_id)}</div>
                </div>
                <button class="btn btn-secondary" onclick="unwatchUser(${u.id})">✅ Снять наблюдение</button>
            </div>
        </div>
    `).join('');
}

async function watchUser(userId, email) {
    const reason = prompt(`Причина наблюдения для ${email}@minzdrav.ru:`);
    if (!reason) return;
    
    const res = await fetch('/api/admin/watch-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason }),
        credentials: 'include'
    });
    
    if (res.ok) {
        alert('✅ Пользователь добавлен под наблюдение');
        await loadUsers();
    }
}

async function unwatchUser(userId) {
    if (!confirm('Снять наблюдение?')) return;
    
    const res = await fetch('/api/admin/unwatch-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
        credentials: 'include'
    });
    
    if (res.ok) {
        alert('✅ Наблюдение снято');
        await loadUsers();
    }
}

async function adminResetPass(userId, email) {
    const newPassword = prompt(`Новый пароль для ${email}@minzdrav.ru:`);
    if (!newPassword || newPassword.length > 32) return;
    
    const res = await fetch('/api/admin/reset-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newPassword }),
        credentials: 'include'
    });
    
    if (res.ok) {
        alert(`✅ Пароль сброшен для ${email}@minzdrav.ru\nНовый пароль: ${newPassword}`);
    } else {
        const data = await res.json();
        alert(data.error || 'Ошибка');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
