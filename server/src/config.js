'use strict';
const path = require('path');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };

module.exports = {
  port: num('PORT', 8000),
  dataDir: path.resolve(env('DATA_DIR', path.join(__dirname, '..', '..', 'data'))),
  publicDir: path.resolve(env('PUBLIC_DIR', path.join(__dirname, '..', '..', 'public'))),
  // за обратным прокси (nginx/Caddy) нужно TRUST_PROXY=1 — иначе IP клиента и https определяются неверно
  trustProxy: env('TRUST_PROXY', ''),
  cookieSecure: env('COOKIE_SECURE', 'auto'),            // auto | true | false
  registration: env('REGISTRATION', 'open') === 'closed' ? 'closed' : 'open',
  registrationCode: env('REGISTRATION_CODE', ''),        // если задан — нужен для регистрации
  userQuotaBytes: num('USER_QUOTA_MB', 1024) * 1024 * 1024,
  maxImageBytes: num('MAX_IMAGE_MB', 40) * 1024 * 1024,
  maxProjectBytes: num('MAX_PROJECT_MB', 20) * 1024 * 1024,
  sessionDays: num('SESSION_DAYS', 30),
  backupEveryHours: num('BACKUP_EVERY_HOURS', 24),
  backupKeep: num('BACKUP_KEEP', 7),
};
