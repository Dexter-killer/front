const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const vapidKeys = {
    publicKey: 'BAWoy40CsEb86i9OfWCxRyRAIFoUDgObFywdNUY5bNvWse0z466t_HX9Lx7dUFApY0xd577knamZhFf_blYnKGc',
    privateKey: 'cYDYjJH6xbVI9I8qPXEjfLF3I543BNzFtEogKJhC6Tc'
};

webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '/')));

let subscriptions = [];
const reminders = new Map();

// Создание HTTP сервера (порт 3000)
const httpServer = http.createServer(app);
const ioHttp = socketIo(httpServer, { cors: { origin: "*" } });

// Создание HTTPS сервера (порт 3001)
let httpsServer;
try {
    const httpsOptions = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
    };
    httpsServer = https.createServer(httpsOptions, app);
} catch (e) {
    console.log("HTTPS не сконфигурирован (ключи не найдены)");
}

// Общая логика сокетов
function setupSocket(io) {
    io.on('connection', (socket) => {
        socket.on('newTask', (task) => {
            socket.broadcast.emit('taskAdded', task);
        });
        socket.on('newReminder', (reminder) => {
            const delay = reminder.reminderTime - Date.now();
            if (delay <= 0) return;
            const timeoutId = setTimeout(() => {
                const payload = JSON.stringify({
                    title: '!!! Напоминание',
                    body: reminder.text,
                    reminderId: reminder.id
                });
                subscriptions.forEach(sub => {
                    webpush.sendNotification(sub, payload).catch(e => {});
                });
                reminders.delete(reminder.id);
            }, delay);
            reminders.set(reminder.id, { timeoutId, text: reminder.text });
        });
    });
}

setupSocket(ioHttp);

app.post('/subscribe', (req, res) => {
    subscriptions.push(req.body);
    res.status(201).json({ success: true });
});

app.post('/unsubscribe', (req, res) => {
    subscriptions = subscriptions.filter(sub => sub.endpoint !== req.body.endpoint);
    res.status(200).json({ success: true });
});

app.post('/snooze', (req, res) => {
    const reminderId = parseInt(req.query.reminderId, 10);
    const reminder = reminders.get(reminderId);
    if (reminder) {
        clearTimeout(reminder.timeoutId);
        const newDelay = 5 * 60 * 1000;
        const timeoutId = setTimeout(() => {
            const payload = JSON.stringify({ title: 'Отложенное напоминание', body: reminder.text, reminderId });
            subscriptions.forEach(sub => webpush.sendNotification(sub, payload).catch(e => {}));
            reminders.delete(reminderId);
        }, newDelay);
        reminders.set(reminderId, { timeoutId, text: reminder.text });
        res.status(200).json({ message: 'Snoozed' });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

httpServer.listen(3000, () => {
    console.log('HTTP Сервер запущен на http://localhost:3000');
});

if (httpsServer) {
    const ioHttps = socketIo(httpsServer, { cors: { origin: "*" } });
    setupSocket(ioHttps);
    httpsServer.listen(3001, () => {
        console.log('HTTPS Сервер запущен на https://localhost:3001');
    });
}
