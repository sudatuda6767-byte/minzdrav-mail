let profileInfo = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadProfile();
    setupHandlers();
});

async function loadProfile() {
    const res = await fetch('/api/profile/info', { credentials: 'include' });
    if (res.status === 401) {
        window.location.href = '/login';
        return;
    }
    profileInfo = await res.json();
    displayProfile();
}

function displayProfile() {
    document.getElementById('userEmailDisplay').textContent = profileInfo.email;
    document.getElementById('uniqueIdDisplay').textContent = profileInfo.uniqueId;
    document.getElementById('createdAtDisplay').textContent = new Date(profileInfo.createdAt).toLocaleString('ru-RU');
    
    // Устанавливаем аватарку с защитой от битой ссылки
    const avatarEl = document.getElementById('avatarPreview');
    avatarEl.onerror = function() {
        this.onerror = null;
        this.src = '/img/default-avatar.svg';
    };
    avatarEl.src = profileInfo.avatar || '/img/default-avatar.png';
    
    document.querySelectorAll('.theme-option').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === profileInfo.theme);
    });
    
    if (profileInfo.customColor) {
        document.querySelectorAll('.color-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.color === profileInfo.customColor);
        });
        document.getElementById('customColorInput').value = profileInfo.customColor;
    }
    
    if (profileInfo.secretBlocked) {
        document.getElementById('secretBlockedMsg').style.display = 'block';
        document.getElementById('secretForm').style.display = 'none';
    }
    if (profileInfo.secretPending) {
        document.getElementById('secretPendingMsg').style.display = 'block';
        document.getElementById('pendingDate').textContent = new Date(profileInfo.secretPending).toLocaleString('ru-RU');
    }
}

function setupHandlers() {
    // Загрузка аватарки
    document.getElementById('avatarInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.size > 5 * 1024 * 1024) {
            alert('Файл больше 5 МБ');
            return;
        }
        if (file.type === 'image/gif') {
            alert('GIF не допускаются');
            return;
        }
        
        const fd = new FormData();
        fd.append('avatar', file);
        
        const res = await fetch('/api/profile/avatar', {
            method: 'POST',
            body: fd,
            credentials: 'include'
        });
        const data = await res.json();
        
        if (res.ok) {
            // Обновляем аватарку с меткой времени чтобы браузер не кешировал старую
            document.getElementById('avatarPreview').src = data.avatar + '?t=' + Date.now();
            profileInfo.avatar = data.avatar;
            showToast('✅ Аватарка обновлена и сохранена навсегда');
        } else {
            alert(data.error || 'Ошибка');
        }
    });
    
    // ⭐ КНОПКА СБРОСА АВАТАРКИ
    document.getElementById('resetAvatarBtn').addEventListener('click', async () => {
        if (!confirm('Сбросить аватарку на дефолтную?\nТекущая аватарка будет удалена безвозвратно.')) return;
        
        const res = await fetch('/api/profile/reset-avatar', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        
        if (res.ok) {
            document.getElementById('avatarPreview').src = data.avatar + '?t=' + Date.now();
            profileInfo.avatar = data.avatar;
            showToast('✅ Аватарка сброшена на дефолтную');
        } else {
            alert(data.error || 'Ошибка');
        }
    });
    
    document.querySelectorAll('.theme-option').forEach(el => {
        el.addEventListener('click', async () => {
            const theme = el.dataset.theme;
            document.querySelectorAll('.theme-option').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            applyTheme(theme, profileInfo.customColor);
            
            await fetch('/api/profile/theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme, customColor: profileInfo.customColor }),
                credentials: 'include'
            });
            profileInfo.theme = theme;
            showToast('✅ Тема изменена');
        });
    });
    
    document.querySelectorAll('.color-option').forEach(el => {
        el.addEventListener('click', async () => {
            const color = el.dataset.color;
            document.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            profileInfo.customColor = color;
            applyTheme(profileInfo.theme, color);
            await saveTheme();
            showToast('✅ Цвет изменён');
        });
    });
    
    document.getElementById('customColorInput').addEventListener('change', async (e) => {
        const color = e.target.value;
        document.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected'));
        profileInfo.customColor = color;
        applyTheme(profileInfo.theme, color);
        await saveTheme();
        showToast('✅ Свой цвет применён');
    });
    
    document.getElementById('passwordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmNewPassword').value;
        
        if (newPassword !== confirmPassword) {
            alert('Пароли не совпадают');
            return;
        }
        if (newPassword.length > 32) {
            alert('Пароль слишком длинный (макс. 32 символа)');
            return;
        }
        
        const res = await fetch('/api/profile/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
            credentials: 'include'
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast('✅ ' + data.message);
            document.getElementById('passwordForm').reset();
        } else {
            alert(data.error || 'Ошибка');
        }
    });
    
    document.getElementById('secretForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('secretChangePassword').value;
        const newSecret = document.getElementById('newSecret').value;
        
        if (newSecret.length > 32) {
            alert('Секретное слово слишком длинное');
            return;
        }
        
        if (!confirm('Запланировать смену секретного слова через 24 часа?\nМожно отменить в любой момент до истечения срока.')) return;
        
        const res = await fetch('/api/profile/request-secret-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, newSecret }),
            credentials: 'include'
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast('✅ ' + data.message);
            document.getElementById('secretForm').reset();
            await loadProfile();
        } else {
            alert(data.error || 'Ошибка');
        }
    });
}

async function saveTheme() {
    await fetch('/api/profile/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            theme: profileInfo.theme, 
            customColor: profileInfo.customColor 
        }),
        credentials: 'include'
    });
}

async function cancelSecretChange() {
    if (!confirm('Отменить запланированную смену секретного слова?')) return;
    
    const res = await fetch('/api/profile/cancel-secret-change', {
        method: 'POST',
        credentials: 'include'
    });
    const data = await res.json();
    
    if (res.ok) {
        showToast('✅ ' + data.message);
        document.getElementById('secretPendingMsg').style.display = 'none';
        await loadProfile();
    }
}

async function blockSecretForever() {
    const confirm1 = confirm('⚠️ ВНИМАНИЕ!\n\nПосле блокировки НИКТО и НИКОГДА не сможет сменить секретное слово, даже вы!\n\nВы уверены?');
    if (!confirm1) return;
    
    const confirm2 = prompt('Для подтверждения введите слово: ЗАБЛОКИРОВАТЬ');
    if (confirm2 !== 'ЗАБЛОКИРОВАТЬ') {
        alert('Отменено');
        return;
    }
    
    const res = await fetch('/api/profile/block-secret-change', {
        method: 'POST',
        credentials: 'include'
    });
    const data = await res.json();
    
    if (res.ok) {
        showToast('🔒 ' + data.message);
        await loadProfile();
    }
}

function toggleId() {
    document.getElementById('uniqueIdDisplay').classList.toggle('revealed');
}

function showToast(msg) {
    const existing = document.getElementById('toast-notify');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'toast-notify';
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--bg-panel);
        color: var(--text-main);
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        border-left: 4px solid var(--success);
        font-size: 14px;
        z-index: 9999;
        animation: slideUp 0.3s;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}
