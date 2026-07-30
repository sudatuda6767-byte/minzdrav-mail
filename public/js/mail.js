// ==================== СОСТОЯНИЕ ====================
let currentUser = null;
let currentFolder = 'all';
let currentCustomFolder = null;
let currentEmails = [];
let selectedEmailIds = [];
let openedEmail = null;
let attachedFiles = [];
let searchQuery = '';
let filters = { dateFrom: '', dateTo: '', fromUser: '' };

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', async () => {
    const me = await fetchAPI('/api/auth/me');
    if (!me.authorized) {
        window.location.href = '/login';
        return;
    }
    currentUser = me.user;
    setupUser();
    
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.emit('register-user', currentUser.id);
        socket.on('new-email', (data) => {
            notify(`📬 Новое письмо от ${data.from}: ${data.subject}`);
            loadEmails();
        });
    }
    
    await checkPendingSecret();
    
    setupHandlers();
    await loadCustomFolders();
    await loadEmails();
});

async function fetchAPI(url, options = {}) {
    try {
        const res = await fetch(url, { credentials: 'include', ...options });
        if (res.status === 401) {
            window.location.href = '/login';
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error('API error:', e);
        return null;
    }
}

function setupUser() {
    document.getElementById('userDropdownName').textContent = currentUser.email;
    // ⚠️ ИЗМЕНЕНО: НЕ показываем ID в дропдауне
    document.getElementById('userDropdownEmail').textContent = 'Профиль пользователя';
    
    if (currentUser.avatar) {
        // Устанавливаем аватарку с защитой от битой ссылки
        const headerAvatar = document.getElementById('headerAvatar');
        headerAvatar.onerror = function() {
            this.onerror = null;
            this.src = '/img/default-avatar.png';
        };
        headerAvatar.src = currentUser.avatar;
    }
    if (currentUser.isAdmin) {
        document.getElementById('adminLink').style.display = 'flex';
    }
    if (currentUser.theme) {
        applyTheme(currentUser.theme, currentUser.customColor);
    }
}

async function checkPendingSecret() {
    const info = await fetchAPI('/api/profile/info');
    if (info?.secretPending && new Date(info.secretPending) < new Date()) {
        await fetchAPI('/api/profile/apply-pending-secret', { method: 'POST' });
        notify('✅ Секретное слово было обновлено');
    }
}

// ==================== ОБРАБОТЧИКИ ====================
function setupHandlers() {
    document.getElementById('userMenuBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('userDropdown').classList.toggle('show');
    });
    document.addEventListener('click', () => {
        document.getElementById('userDropdown').classList.remove('show');
    });
    
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetchAPI('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    });
    
    document.querySelectorAll('.folder-item[data-folder]').forEach(el => {
        el.addEventListener('click', () => {
            switchFolder(el.dataset.folder, el.querySelector('span:nth-child(2)').textContent);
        });
    });
    
    document.getElementById('siteBtn').addEventListener('click', (e) => {
        e.preventDefault();
        notify('🌐 Сайт находится в разработке');
    });
    
    document.getElementById('supportBtn').addEventListener('click', () => {
        openCompose('tekhnicheskaya-podderzhka-pochty@minzdrav.ru');
    });
    
    document.getElementById('composeBtn').addEventListener('click', () => openCompose());
    document.getElementById('closeComposeBtn').addEventListener('click', closeCompose);
    document.getElementById('composeModal').addEventListener('click', (e) => {
        if (e.target.id === 'composeModal') closeCompose();
    });
    
    document.getElementById('sendBtn').addEventListener('click', () => sendEmail(false));
    document.getElementById('saveDraftBtn').addEventListener('click', () => sendEmail(true));
    
    document.getElementById('toggleCcBtn').addEventListener('click', () => {
        const cc = document.getElementById('ccField');
        const bcc = document.getElementById('bccField');
        const show = cc.style.display === 'none';
        cc.style.display = show ? 'flex' : 'none';
        bcc.style.display = show ? 'flex' : 'none';
    });
    
    document.querySelectorAll('.editor-btn[data-cmd]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.execCommand(btn.dataset.cmd, false, null);
            document.getElementById('composeBody').focus();
        });
    });
    
    document.getElementById('insertLinkBtn').addEventListener('click', () => {
        const url = prompt('Введите URL:', 'https://');
        if (url) document.execCommand('createLink', false, url);
    });
    
    document.getElementById('insertImageBtn').addEventListener('click', () => {
        const url = prompt('Ссылка на изображение:', 'https://');
        if (url) document.execCommand('insertImage', false, url);
    });
    
    document.getElementById('attachFileBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileAttach);
    
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchQuery = e.target.value;
        searchTimeout = setTimeout(loadEmails, 400);
    });
    
    document.getElementById('filtersToggle').addEventListener('click', () => {
        const p = document.getElementById('filtersPanel');
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('applyFilters').addEventListener('click', () => {
        filters.dateFrom = document.getElementById('filterDateFrom').value;
        filters.dateTo = document.getElementById('filterDateTo').value;
        filters.fromUser = document.getElementById('filterFrom').value;
        loadEmails();
    });
    document.getElementById('resetFilters').addEventListener('click', () => {
        document.getElementById('filterDateFrom').value = '';
        document.getElementById('filterDateTo').value = '';
        document.getElementById('filterFrom').value = '';
        filters = { dateFrom: '', dateTo: '', fromUser: '' };
        loadEmails();
    });
    
    document.getElementById('refreshBtn').addEventListener('click', loadEmails);
    document.getElementById('selectAllBtn').addEventListener('click', toggleSelectAll);
    document.getElementById('markReadBtn').addEventListener('click', () => doAction('read'));
    document.getElementById('starBtn').addEventListener('click', () => doAction('star'));
    document.getElementById('moveToSpamBtn').addEventListener('click', () => doAction('spam'));
    document.getElementById('deleteBtn').addEventListener('click', () => {
        if (currentFolder === 'trash') {
            if (confirm('Удалить безвозвратно?')) doAction('delete-forever');
        } else {
            doAction('delete');
        }
    });
    
    document.getElementById('addFolderBtn').addEventListener('click', async () => {
        const name = prompt('Название папки:');
        if (!name) return;
        const res = await fetchAPI('/api/mail/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res?.success) {
            await loadCustomFolders();
            notify('✅ Папка создана');
        }
    });
}

// ==================== ПАПКИ ====================
async function loadCustomFolders() {
    const data = await fetchAPI('/api/mail/folders');
    const container = document.getElementById('customFolders');
    container.innerHTML = '';
    if (data?.folders) {
        data.folders.forEach(f => {
            const li = document.createElement('li');
            li.className = 'folder-item';
            li.innerHTML = `
                <span class="folder-icon">📁</span>
                <span>${escapeHtml(f.folder_name)}</span>
                <button class="icon-btn" style="margin-left: auto; padding: 2px 6px;" onclick="deleteFolder(${f.id}, event)">×</button>
            `;
            li.addEventListener('click', () => {
                currentCustomFolder = f.folder_name;
                switchFolder('custom', f.folder_name);
            });
            container.appendChild(li);
        });
    }
}

async function deleteFolder(id, e) {
    e.stopPropagation();
    if (!confirm('Удалить папку? (Письма не удалятся)')) return;
    await fetchAPI('/api/mail/folders/' + id, { method: 'DELETE' });
    await loadCustomFolders();
}

function switchFolder(folder, title) {
    currentFolder = folder;
    document.getElementById('folderTitle').textContent = title;
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    if (folder !== 'custom') {
        document.querySelector(`.folder-item[data-folder="${folder}"]`)?.classList.add('active');
    }
    openedEmail = null;
    showEmptyView();
    loadEmails();
}

// ==================== ПИСЬМА ====================
async function loadEmails() {
    const container = document.getElementById('emailListContainer');
    container.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">Загрузка...</div>';
    
    const params = new URLSearchParams();
    if (searchQuery) params.append('search', searchQuery);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (filters.fromUser) params.append('fromUser', filters.fromUser);
    
    const folderPath = currentFolder === 'custom' ? currentCustomFolder : currentFolder;
    const data = await fetchAPI(`/api/mail/folder/${encodeURIComponent(folderPath)}?${params}`);
    
    if (!data) return;
    currentEmails = data.emails || [];
    selectedEmailIds = [];
    
    const inboxCount = document.getElementById('count-inbox');
    const allCount = document.getElementById('count-all');
    if (inboxCount) {
        inboxCount.textContent = data.unreadCount || 0;
        inboxCount.classList.toggle('zero', !data.unreadCount);
    }
    if (allCount) {
        allCount.textContent = data.unreadCount || 0;
        allCount.classList.toggle('zero', !data.unreadCount);
    }
    
    renderEmails();
}

function renderEmails() {
    const container = document.getElementById('emailListContainer');
    
    if (currentEmails.length === 0) {
        container.innerHTML = `
            <div style="padding: 60px 20px; text-align: center; color: var(--text-muted);">
                <div style="font-size: 48px; margin-bottom: 12px;">📭</div>
                <div>Писем нет</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = currentEmails.map(e => {
        const from = e.from.split('@')[0];
        const letter = from.charAt(0).toUpperCase();
        const date = formatDate(e.sentAt);
        const preview = stripHtml(e.body).substring(0, 60);
        const isSelected = selectedEmailIds.includes(e.id);
        
        return `
            <div class="email-item ${!e.isRead ? 'unread' : ''} ${isSelected ? 'selected' : ''}" data-id="${e.id}">
                <input type="checkbox" class="email-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${e.id})">
                <div class="email-avatar">${letter}</div>
                <div class="email-body">
                    <div class="email-from">
                        <span>${escapeHtml(from)}</span>
                        <span class="email-date">${date}</span>
                    </div>
                    <div class="email-subject">${escapeHtml(e.subject || '(Без темы)')}</div>
                    <div class="email-preview">${escapeHtml(preview)}</div>
                    <div class="email-badges">
                        ${e.isStarred ? '<span class="badge badge-star">⭐</span>' : ''}
                        ${e.isUnwanted ? '<span class="badge" style="background:#FEF3C7;color:#92400E;">⚠️ Нежелательное</span>' : ''}
                        ${(e.labels || []).map(l => `<span class="badge badge-label">${escapeHtml(l)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.querySelectorAll('.email-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            openEmail(parseInt(item.dataset.id));
        });
    });
}

function toggleSelect(id) {
    const idx = selectedEmailIds.indexOf(id);
    if (idx === -1) selectedEmailIds.push(id);
    else selectedEmailIds.splice(idx, 1);
    renderEmails();
}

function toggleSelectAll() {
    if (selectedEmailIds.length === currentEmails.length) {
        selectedEmailIds = [];
    } else {
        selectedEmailIds = currentEmails.map(e => e.id);
    }
    renderEmails();
}

async function doAction(action, value) {
    if (selectedEmailIds.length === 0 && openedEmail) {
        selectedEmailIds = [openedEmail.id];
    }
    if (selectedEmailIds.length === 0) {
        notify('⚠️ Выберите письма');
        return;
    }
    
    const res = await fetchAPI('/api/mail/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: selectedEmailIds, action, value })
    });
    
    if (res?.success) {
        selectedEmailIds = [];
        openedEmail = null;
        showEmptyView();
        await loadEmails();
    }
}

async function openEmail(id) {
    const data = await fetchAPI('/api/mail/email/' + id);
    if (!data) return;
    openedEmail = data;
    
    const from = data.from.split('@')[0];
    const letter = from.charAt(0).toUpperCase();
    
    const view = document.getElementById('emailView');
    view.innerHTML = `
        ${data.isUnwanted ? `
            <div class="unwanted-warning">
                <strong>⚠️ Администрация почты уведомляет!</strong>
                Вы получили нежелательное письмо от данного пользователя. Пользователь находится под особым контролем и наблюдением у Администрации. Все переходы по ссылкам и/или на внешние ресурсы от данного пользователя не застрахованы Администрацией этой платформы, всё делаете на свой страх и риск. Если считаете что пользователь не должен отправлять подобное — сообщите об этом Администрации.
                <div style="margin-top: 6px; font-style: italic;">С уважением — Администрация почты minzdrav.ru</div>
            </div>
        ` : ''}
        
        <div class="email-view-header">
            <h1 class="email-view-subject">${escapeHtml(data.subject || '(Без темы)')}</h1>
            <div class="email-view-meta">
                <div class="email-avatar">${letter}</div>
                <div class="email-view-info">
                    <div class="email-view-from">${escapeHtml(data.from)}</div>
                    <div class="email-view-to">Кому: ${escapeHtml(data.to)}</div>
                </div>
                <div class="email-view-time">${formatFullDate(data.sentAt)}</div>
            </div>
        </div>
        
        <div class="email-view-actions">
            <button class="btn" onclick="replyEmail()">↩️ Ответить</button>
            <button class="btn btn-secondary" onclick="forwardEmail()">↪️ Переслать</button>
            <button class="btn btn-secondary" onclick="doAction('${data.isStarred ? 'unstar' : 'star'}')">${data.isStarred ? '☆ Убрать звезду' : '⭐ Пометить'}</button>
            <button class="btn btn-secondary" onclick="addLabelPrompt()">🏷️ Метка</button>
            <button class="btn btn-secondary" onclick="moveToFolderPrompt()">📁 В папку</button>
            <button class="btn btn-danger" onclick="doAction('delete')">🗑️ Удалить</button>
        </div>
        
        <div class="email-view-body">${data.body || '<em>(пустое письмо)</em>'}</div>
        
        ${data.attachments?.length ? `
            <div class="attachments-list">
                <h3>📎 Вложения (${data.attachments.length})</h3>
                ${data.attachments.map(a => `
                    <a href="/api/mail/attachment/${a.id}" class="attachment-item" download>
                        <span class="attachment-icon">📄</span>
                        <div class="attachment-info">
                            <div>${escapeHtml(a.filename)}</div>
                            <div class="attachment-size">${formatSize(a.filesize)}</div>
                        </div>
                        <span>⬇️</span>
                    </a>
                `).join('')}
            </div>
        ` : ''}
    `;
    view.classList.add('show-mobile');
    
    setTimeout(loadEmails, 500);
}

function showEmptyView() {
    document.getElementById('emailView').innerHTML = `
        <div class="empty-view">
            <img src="/img/logo.png" alt="minzdrav">
            <h2>Выберите письмо</h2>
            <p>Здесь появится содержимое выбранного письма</p>
        </div>
    `;
}

async function addLabelPrompt() {
    const label = prompt('Название метки:');
    if (label) {
        selectedEmailIds = [openedEmail.id];
        await doAction('label', label);
    }
}

async function moveToFolderPrompt() {
    const data = await fetchAPI('/api/mail/folders');
    if (!data?.folders?.length) {
        notify('Сначала создайте папку в боковой панели');
        return;
    }
    const names = data.folders.map(f => f.folder_name);
    const choice = prompt('В какую папку переместить?\n' + names.map((n, i) => `${i+1}. ${n}`).join('\n'));
    const idx = parseInt(choice) - 1;
    if (names[idx]) {
        selectedEmailIds = [openedEmail.id];
        await doAction('move-to-folder', names[idx]);
    }
}

// ==================== НАПИСАНИЕ ====================
function openCompose(to = '', replyData = null) {
    document.getElementById('composeModal').classList.add('show');
    document.getElementById('composeTo').value = to;
    if (replyData) {
        document.getElementById('composeSubject').value = replyData.subject;
        document.getElementById('composeBody').innerHTML = replyData.body;
    } else {
        document.getElementById('composeSubject').value = '';
        document.getElementById('composeBody').innerHTML = '';
    }
    attachedFiles = [];
    document.getElementById('attachmentPreview').innerHTML = '';
    document.getElementById('composeTo').focus();
}

function closeCompose() {
    if (document.getElementById('composeBody').innerHTML.trim() || document.getElementById('composeTo').value) {
        if (!confirm('Закрыть без сохранения?')) return;
    }
    document.getElementById('composeModal').classList.remove('show');
    attachedFiles = [];
}

function replyEmail() {
    if (!openedEmail) return;
    openCompose(openedEmail.from, {
        subject: 'Re: ' + openedEmail.subject,
        body: `<br><br><blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #666;">${openedEmail.body}</blockquote>`
    });
}

function forwardEmail() {
    if (!openedEmail) return;
    openCompose('', {
        subject: 'Fwd: ' + openedEmail.subject,
        body: `<br><br>--- Пересланное письмо ---<br>От: ${openedEmail.from}<br><br>${openedEmail.body}`
    });
}

function handleFileAttach(e) {
    const files = Array.from(e.target.files);
    for (const f of files) {
        if (f.size > 10 * 1024 * 1024) {
            notify(`⚠️ Файл ${f.name} больше 10 МБ`);
            continue;
        }
        attachedFiles.push(f);
    }
    renderAttachments();
    e.target.value = '';
}

function renderAttachments() {
    document.getElementById('attachmentPreview').innerHTML = attachedFiles.map((f, i) => `
        <div class="attachment-chip">
            📄 ${escapeHtml(f.name)} (${formatSize(f.size)})
            <button onclick="removeAttachment(${i})">×</button>
        </div>
    `).join('');
}

function removeAttachment(i) {
    attachedFiles.splice(i, 1);
    renderAttachments();
}

async function sendEmail(isDraft) {
    const to = document.getElementById('composeTo').value.trim();
    const cc = document.getElementById('composeCc').value.trim();
    const bcc = document.getElementById('composeBcc').value.trim();
    const subject = document.getElementById('composeSubject').value.trim();
    const body = document.getElementById('composeBody').innerHTML;
    
    if (!isDraft && !to) {
        notify('⚠️ Укажите получателя');
        return;
    }
    
    const formData = new FormData();
    formData.append('to', to);
    formData.append('cc', cc);
    formData.append('bcc', bcc);
    formData.append('subject', subject);
    formData.append('body', body);
    formData.append('isDraft', isDraft ? 'true' : 'false');
    attachedFiles.forEach(f => formData.append('attachments', f));
    
    try {
        const res = await fetch('/api/mail/send', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        const data = await res.json();
        
        if (res.ok) {
            notify(isDraft ? '💾 Черновик сохранён' : `📤 Письмо отправлено (${data.sent} получателям)`);
            document.getElementById('composeModal').classList.remove('show');
            attachedFiles = [];
            loadEmails();
        } else {
            notify('⚠️ ' + (data.error || 'Ошибка'));
        }
    } catch (e) {
        notify('⚠️ Ошибка отправки');
    }
}

// ==================== УТИЛИТЫ ====================
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || tmp.innerText || '';
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
        return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatFullDate(dateStr) {
    return new Date(dateStr).toLocaleString('ru-RU', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function notify(msg) {
    const existing = document.getElementById('notify-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'notify-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--bg-panel);
        color: var(--text-main);
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        border-left: 4px solid var(--brand-blue-light);
        font-size: 14px;
        z-index: 9999;
        max-width: 380px;
        animation: slideUp 0.3s;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 4000);
    
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('minzdrav.ru', { body: msg, icon: '/img/logo.png' });
    }
}

if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission(), 3000);
}
