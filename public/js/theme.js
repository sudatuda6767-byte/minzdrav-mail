// ==================== СИСТЕМА ТЕМ ====================

// Применить тему
function applyTheme(theme, customColor) {
    document.documentElement.setAttribute('data-theme', theme);
    
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    
    // Кастомный цвет
    if (customColor) {
        const root = document.documentElement;
        root.style.setProperty('--brand-blue-light', customColor);
        root.style.setProperty('--brand-gradient', `linear-gradient(135deg, ${customColor} 0%, #10B981 100%)`);
    }
    
    // Сохраняем в localStorage
    localStorage.setItem('theme', theme);
    if (customColor) localStorage.setItem('customColor', customColor);
}

// Загрузка темы при старте
const savedTheme = localStorage.getItem('theme') || 'light';
const savedColor = localStorage.getItem('customColor');
applyTheme(savedTheme, savedColor);

// Переключатель темы
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.addEventListener('click', async () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const newTheme = current === 'light' ? 'dark' : 'light';
            applyTheme(newTheme);
            
            // Сохраняем на сервере
            try {
                await fetch('/api/profile/theme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ theme: newTheme }),
                    credentials: 'include'
                });
            } catch (e) {}
        });
    }
});
