// src/worker/index.ts
import '../queues/workers/search.worker.js';
import '../queues/workers/price-alert.worker.js';

export async function startWorker() {
  console.log('👷 Воркеры запущены');
  // Здесь можно добавить инициализацию, если нужно
}
