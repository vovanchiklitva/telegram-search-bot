import express from 'express';

// Импортируем исходные модули (они запустятся при импорте)
import './bot/index';
import './worker/index';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`✅ Health check сервер запущен на порту ${PORT}`);
});

console.log('✅ Бот и воркер запущены');
