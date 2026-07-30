// ==================== УТИЛИТЫ ====================
function showError(msg) {
    const el = document.getElementById('errorMsg');
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
        document.getElementById('successMsg')?.classList.remove('show');
        setTimeout(() => el.classList.remove('show'), 6000);
    }
}

function showSuccess(msg) {
    const el = document.getElementById('successMsg');
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
        document.getElementById('errorMsg')?.classList.remove('show');
    }
}

async function apiCall(url, method, data) {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: data ? JSON.stringify(data) : undefined,
            credentials: 'include'
        });
        const json = await res.json();
        return { ok: res.ok, status: res.status, data: json };
    } catch (err) {
        return { ok: false, data: { error: 'Ошибка сети' } };
    }
}

// ==================== РЕГИСТРАЦИЯ ====================
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    // Валидация ввода почты в реальном времени
    const emailInput = document.getElementById('email');
    emailInput.addEventListener('input', (e) => {
        // Убираем всё кроме a-z и 0-9
        let val = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (val.length > 32) val = val.substring(0, 32);
        e.target.value = val;
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const secretWord = document.getElementById('secretWord').value.trim();

        // Клиентская валидация
        if (!email || !password || !confirmPassword || !secretWord) {
            return showError('Заполните все поля');
        }
        if (email.length > 32) return showError('Название почты слишком длинное');
        if (!/^[a-z0-9]+$/.test(email)) {
            return showError('Только английские буквы (маленькие) и цифры');
        }
        if (password.length > 32) return showError('Пароль слишком длинный (макс. 32 символа)');
        if (password !== confirmPassword) return showError('Пароли не совпадают');
        if (secretWord.length > 32) return showError('Секретное слово слишком длинное');

        const res = await apiCall('/api/auth/register', 'POST', {
            email, password, confirmPassword, secretWord
        });

        if (res.ok) {
            showSuccess(`Регистрация успешна! Ваш ID: ${res.data.user.uniqueId}. Перенаправляем...`);
            
            // Триггерим сохранение пароля браузером
            const form = document.getElementById('registerForm');
            if (form) {
                // Стандартный трюк для менеджера паролей
                setTimeout(() => {
                    window.location.href = '/mail';
                }, 1500);
            }
        } else {
            showError(res.data.error || 'Ошибка регистрации');
        }
    });
}

// ==================== ВХОД ====================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim().toLowerCase();
        const password = document.getElementById('password').value;

        if (!email || !password) return showError('Заполните все поля');

        const res = await apiCall('/api/auth/login', 'POST', { email, password });

        if (res.ok) {
            showSuccess('Вход выполнен! Перенаправляем...');
            setTimeout(() => window.location.href = '/mail', 800);
        } else {
            showError(res.data.error || 'Неверные данные');
        }
    });
}

// ==================== ВОССТАНОВЛЕНИЕ ====================
const recoveryForm = document.getElementById('recoveryForm');
if (recoveryForm) {
    recoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim().toLowerCase();
        const secretWord = document.getElementById('secretWord').value.trim();

        if (!email || !secretWord) return showError('Заполните все поля');

        const res = await apiCall('/api/auth/recovery', 'POST', { email, secretWord });

        if (res.ok) {
            showSuccess(res.data.message || 'Доступ восстановлен!');
            setTimeout(() => window.location.href = '/mail', 1500);
        } else {
            showError(res.data.error || 'Ошибка');
            if (res.data.showTicket) {
                setTimeout(() => {
                    if (confirm('Хотите создать обращение в техподдержку?')) {
                        window.location.href = '/ticket';
                    }
                }, 1000);
            }
        }
    });
}

// ==================== ТИКЕТ ====================
const ticketForm = document.getElementById('ticketForm');
if (ticketForm) {
    ticketForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const lostEmail = document.getElementById('lostEmail').value.trim().toLowerCase();
        const description = document.getElementById('description').value.trim();

        if (!lostEmail || !description) return showError('Заполните все поля');
        if (description.length < 20) return showError('Опишите ситуацию подробнее (минимум 20 символов)');

        const res = await apiCall('/api/tickets/create', 'POST', { lostEmail, description });

        if (res.ok) {
            showSuccess(`Обращение №${res.data.ticketId} создано! С вами свяжется техподдержка.`);
            ticketForm.reset();
            setTimeout(() => window.location.href = '/login', 3500);
        } else {
            showError(res.data.error || 'Ошибка');
        }
    });
}
