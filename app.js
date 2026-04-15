const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enableBtn = document.getElementById('enable-push');
const disableBtn = document.getElementById('disable-push');

// Подключение к сокетам (автоматически выбирает текущий хост и протокол)
const socket = io();

const VAPID_PUBLIC_KEY = 'BAWoy40CsEb86i9OfWCxRyRAIFoUDgObFywdNUY5bNvWse0z466t_HX9Lx7dUFApY0xd577knamZhFf_blYnKGc';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function setActiveButton(activeId) {
    const buttons = [homeBtn, aboutBtn];
    buttons.forEach(btn => btn && btn.classList.remove('active'));
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.classList.add('active');
}

async function loadContent(page) {
    try {
        console.log('Загрузка страницы:', page);
        const response = await fetch(`/content/${page}.html`);
        if (!response.ok) throw new Error('Network error');
        const html = await response.text();
        contentDiv.innerHTML = html;
        if (page === 'home') initNotes();
    } catch (err) {
        console.error('Ошибка загрузки:', err);
        contentDiv.innerHTML = `<p class="is-center text-error">Ошибка загрузки страницы.</p>`;
    }
}

homeBtn.onclick = () => { setActiveButton('home-btn'); loadContent('home'); };
aboutBtn.onclick = () => { setActiveButton('about-btn'); loadContent('about'); };

// Сначала загружаем контент, потом регистрируем SW
document.addEventListener('DOMContentLoaded', async () => {
    await loadContent('home');
    
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker успешно зарегистрирован!');

            const sub = await reg.pushManager.getSubscription();
            updatePushButtons(sub);

            enableBtn.onclick = async () => {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    const newSub = await subscribeToPush(reg);
                    updatePushButtons(newSub);
                } else {
                    alert('Разрешите уведомления в настройках браузера.');
                }
            };

            disableBtn.onclick = async () => {
                await unsubscribeFromPush(reg);
                updatePushButtons(null);
            };

        } catch (err) {
            console.error('Ошибка Service Worker:', err);
            // Если ошибка SecurityError, подсказываем пользователю
            if (err.name === 'SecurityError') {
                console.warn('Совет: попробуйте открыть http://localhost:3000 вместо HTTPS');
            }
        }
    }
});

function initNotes() {
    const noteForm = document.getElementById('note-form');
    const noteInput = document.getElementById('note-input');
    const reminderForm = document.getElementById('reminder-form');
    const reminderText = document.getElementById('reminder-text');
    const reminderTime = document.getElementById('reminder-time');
    const list = document.getElementById('notes-list');

    if (!noteForm || !list) return;

    function loadNotes() {
        const notes = JSON.parse(localStorage.getItem('notes')) || [];
        list.innerHTML = notes.map(note => {
            let rem = note.reminder ? `<br><small style="color:#d43f3a">🔔 Напоминание: ${new Date(note.reminder).toLocaleString()}</small>` : '';
            return `<li class="card" style="margin-bottom:10px; padding:10px; border-left:5px solid #4285f4; list-style:none;">
                <strong>${note.text}</strong>${rem}
            </li>`;
        }).join('');
    }

    noteForm.onsubmit = (e) => {
        e.preventDefault();
        const text = noteInput.value.trim();
        if (text) {
            const notes = JSON.parse(localStorage.getItem('notes')) || [];
            notes.push({ id: Date.now(), text, reminder: null });
            localStorage.setItem('notes', JSON.stringify(notes));
            socket.emit('newTask', { text });
            loadNotes();
            noteInput.value = '';
        }
    };

    if (reminderForm) {
        reminderForm.onsubmit = (e) => {
            e.preventDefault();
            const text = reminderText.value.trim();
            const time = new Date(reminderTime.value).getTime();
            if (text && time > Date.now()) {
                const notes = JSON.parse(localStorage.getItem('notes')) || [];
                const id = Date.now();
                notes.push({ id, text, reminder: time });
                localStorage.setItem('notes', JSON.stringify(notes));
                socket.emit('newReminder', { id, text, reminderTime: time });
                loadNotes();
                reminderText.value = '';
                reminderTime.value = '';
            } else {
                alert('Выберите время в будущем!');
            }
        };
    }
    loadNotes();
}

function updatePushButtons(sub) {
    if (enableBtn && disableBtn) {
        enableBtn.style.display = sub ? 'none' : 'inline-block';
        disableBtn.style.display = sub ? 'inline-block' : 'none';
    }
}

async function subscribeToPush(reg) {
    try {
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        await fetch('/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub)
        });
        console.log('Подписка на Push оформлена!');
        return sub;
    } catch (e) {
        console.error('Ошибка подписки:', e);
    }
}

async function unsubscribeFromPush(reg) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
        await fetch('/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub)
        });
        await sub.unsubscribe();
        console.log('Подписка отменена.');
    }
}

socket.on('taskAdded', (task) => {
    console.log('Новая заметка:', task.text);
    // Визуальное уведомление на странице
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4285f4;color:white;padding:15px;border-radius:5px;z-index:9999;';
    toast.textContent = `Новая заметка: ${task.text}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
});
