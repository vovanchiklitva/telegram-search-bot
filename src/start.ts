import express from 'express';

// Запускаем бота и воркера параллельно
import('./bot');
import('./worker');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`✅ Health check сервер запущен на порту ${PORT}`);
});

console.log('✅ Бот и воркер запущены');
