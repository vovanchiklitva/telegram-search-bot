import express from 'express';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.send('OK');
});

// Запускаем бота и воркера как отдельные процессы
const bot = spawn('npm', ['run', 'start:bot'], { stdio: 'inherit' });
const worker = spawn('npm', ['run', 'start:worker'], { stdio: 'inherit' });

// При завершении родительского процесса – завершаем дочерние
process.on('SIGINT', () => {
  bot.kill();
  worker.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  bot.kill();
  worker.kill();
  process.exit();
});

console.log('✅ Бот и воркер запущены');
