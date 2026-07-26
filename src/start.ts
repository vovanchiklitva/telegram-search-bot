// src/start.ts
import express from 'express';
import { startBot } from './bot/index.js';
import { startWorker } from './worker/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`✅ Health check на порту ${PORT}`));

// Запускаем бота и воркера параллельно
startBot().catch(err => console.error('❌ Бот упал:', err));
startWorker().catch(err => console.error('❌ Воркер упал:', err));

console.log('✅ Бот и воркер инициированы');
