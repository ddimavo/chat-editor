#!/usr/bin/env node
'use strict';
// Администрирование: docker compose exec app node server/src/cli.js <команда>
const crypto = require('crypto');
const { db } = require('./db');
const S = require('./security');
const backup = require('./backup');

const [cmd, a, b] = process.argv.slice(2);
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const mb = n => (n / 1048576).toFixed(1) + ' МБ';

(async () => {
  switch (cmd) {
    case 'users': {
      const rows = db.prepare(`SELECT u.id, u.username, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM situations s WHERE s.user_id = u.id) AS sits,
        (SELECT COALESCE(SUM(size), 0) FROM images i WHERE i.user_id = u.id) AS bytes FROM users u ORDER BY u.id`).all();
      if (!rows.length) console.log('Пользователей нет.');
      for (const r of rows) console.log(`#${r.id}\t${r.username}\tситуаций: ${r.sits}\tкартинки: ${mb(r.bytes)}\tсоздан: ${new Date(r.created_at).toISOString().slice(0, 10)}\tвход: ${r.last_login ? new Date(r.last_login).toISOString().slice(0, 16).replace('T', ' ') : '—'}`);
      break;
    }
    case 'create': {
      if (!USERNAME_RE.test(a || '')) throw new Error('Использование: create <логин> [пароль]  (логин: 3–32 символа, латиница/цифры/_-.)');
      const pass = b || crypto.randomBytes(9).toString('base64url');
      db.prepare('INSERT INTO users (username, pass, created_at) VALUES (?, ?, ?)').run(a, await S.hashPassword(pass), Date.now());
      console.log(`Пользователь создан: ${a}\nПароль: ${pass}`);
      break;
    }
    case 'passwd': {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(a || '');
      if (!u) throw new Error('Использование: passwd <логин> [новый пароль] — пользователь не найден');
      const pass = b || crypto.randomBytes(9).toString('base64url');
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(await S.hashPassword(pass), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      console.log(`Пароль для ${a} изменён (все сессии завершены).\nНовый пароль: ${pass}`);
      break;
    }
    case 'delete': {
      const r = db.prepare('DELETE FROM users WHERE username = ?').run(a || '');
      console.log(r.changes ? `Пользователь ${a} удалён вместе со всеми данными.` : 'Пользователь не найден.');
      break;
    }
    case 'backup':
      console.log('Резервная копия: ' + await backup.makeBackup());
      break;
    default:
      console.log('Команды:\n  users                       список пользователей\n  create <логин> [пароль]     создать пользователя\n  passwd <логин> [пароль]     сменить пароль (без пароля — сгенерировать)\n  delete <логин>              удалить пользователя и все его данные\n  backup                      сделать резервную копию базы сейчас');
  }
})().catch(e => { console.error('Ошибка:', e.message); process.exitCode = 1; }).finally(() => { try { db.close(); } catch { /* ok */ } });
