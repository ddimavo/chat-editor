'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { db } = require('./db');

const dir = path.join(cfg.dataDir, 'backups');

/** Согласованная копия базы (безопасна при работающем сервере). */
async function makeBackup() {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const target = path.join(dir, `chat-editor-${stamp}.sqlite`);
  await db.backup(target);
  prune();
  return target;
}

function list() {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^chat-editor-.*\.sqlite$/.test(f)).sort();
}
function prune() {
  const all = list();
  for (const f of all.slice(0, Math.max(0, all.length - cfg.backupKeep))) fs.unlinkSync(path.join(dir, f));
}

/** Автокопии: при старте (если последней больше интервала) и далее по таймеру. */
function schedule(log = console.log) {
  if (!(cfg.backupEveryHours > 0)) return;
  const every = cfg.backupEveryHours * 3600_000;
  const run = () => makeBackup().then(f => log(`Резервная копия: ${f}`)).catch(e => console.error('Ошибка резервного копирования:', e));
  const last = list().pop();
  const age = last ? Date.now() - fs.statSync(path.join(dir, last)).mtimeMs : Infinity;
  setTimeout(run, age >= every ? 5000 : every - age).unref();
  setInterval(run, every).unref();
}

module.exports = { makeBackup, schedule, dir };
