'use strict';
const cfg = require('./config');
const { db, file } = require('./db');
const { createApp } = require('./app');
const backup = require('./backup');

const app = createApp();
const server = app.listen(cfg.port, () => {
  console.log(`Chat Editor запущен на порту ${cfg.port}`);
  console.log(`База данных: ${file}`);
  console.log(`Регистрация: ${cfg.registration}${cfg.registrationCode ? ' (по коду приглашения)' : ''}`);
});
backup.schedule();

function shutdown(sig) {
  console.log(`${sig}: останавливаюсь…`);
  server.close(() => { try { db.close(); } catch { /* уже закрыта */ } process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
