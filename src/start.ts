import express from 'express';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`✅ Health check сервер запущен на порту ${PORT}`));

// Запускаем бота и воркера напрямую (без npm)
const bot = spawn('node', ['dist/bot/index.js'], { stdio: 'inherit' });
const worker = spawn('node', ['dist/worker/index.js'], { stdio: 'inherit' });

process.on('SIGINT', () => { bot.kill(); worker.kill(); process.exit(); });
process.on('SIGTERM', () => { bot.kill(); worker.kill(); process.exit(); });

console.log('✅ Бот и воркер запущены');
