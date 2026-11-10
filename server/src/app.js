'use strict';
const express = require('express');
const cfg = require('./config');
const { db } = require('./db');
const S = require('./security');

const COOKIE = 'ce_sid';
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const now = () => Date.now();

// ---------- подготовленные запросы ----------
const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, pass, created_at) VALUES (?, ?, ?)'),
  setPass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
  touchLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)'),
  session: db.prepare('SELECT s.token, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  extendSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  delUserSessionsExcept: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
  delExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  state: db.prepare('SELECT settings, active, rev FROM user_state WHERE user_id = ?'),
  upsertState: db.prepare(`INSERT INTO user_state (user_id, settings, active, rev, updated_at) VALUES (@uid, @settings, @active, @rev, @t)
                           ON CONFLICT(user_id) DO UPDATE SET settings = @settings, active = @active, rev = @rev, updated_at = @t`),
  sits: db.prepare('SELECT id, data FROM situations WHERE user_id = ? ORDER BY position'),
  sitIds: db.prepare('SELECT id FROM situations WHERE user_id = ?'),
  upsertSit: db.prepare(`INSERT INTO situations (user_id, id, position, name, data, updated_at) VALUES (@uid, @id, @pos, @name, @data, @t)
                         ON CONFLICT(user_id, id) DO UPDATE SET position = @pos, name = @name, data = @data, updated_at = @t`),
  delSit: db.prepare('DELETE FROM situations WHERE user_id = ? AND id = ?'),
  docs: db.prepare('SELECT id, kind, title, html, updated_at AS t FROM docs WHERE user_id = ? ORDER BY position'),
  docIds: db.prepare('SELECT id FROM docs WHERE user_id = ?'),
  upsertDoc: db.prepare(`INSERT INTO docs (user_id, id, position, kind, title, html, updated_at) VALUES (@uid, @id, @pos, @kind, @title, @html, @t)
    ON CONFLICT(user_id, id) DO UPDATE SET position = excluded.position, kind = excluded.kind, title = excluded.title, html = excluded.html, updated_at = excluded.updated_at`),
  delDoc: db.prepare('DELETE FROM docs WHERE user_id = ? AND id = ?'),
  imgInfo: db.prepare('SELECT mime, size FROM images WHERE user_id = ? AND id = ?'),
  imgGet: db.prepare('SELECT mime, data FROM images WHERE user_id = ? AND id = ?'),
  imgList: db.prepare('SELECT id, size FROM images WHERE user_id = ? ORDER BY created_at'),
  imgInsert: db.prepare('INSERT INTO images (user_id, id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  imgDel: db.prepare('DELETE FROM images WHERE user_id = ? AND id = ?'),
  usedBytes: db.prepare('SELECT COALESCE(SUM(size), 0) AS n, COUNT(*) AS c FROM images WHERE user_id = ?'),
  sitCount: db.prepare('SELECT COUNT(*) AS c FROM situations WHERE user_id = ?'),
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битая cookie */ }
  }
  return out;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);
  const limiter = new S.RateLimiter();

  // ---------- заголовки безопасности ----------
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; " +
      "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    next();
  });

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

  // ---------- cookie / сессии ----------
  const secureCookie = req => cfg.cookieSecure === 'true' || (cfg.cookieSecure === 'auto' && req.secure);
  function setSessionCookie(req, res, token) {
    const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${cfg.sessionDays * 86400}`];
    if (secureCookie(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  const clearSessionCookie = (req, res) =>
    res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie(req) ? '; Secure' : ''}`);
  function createSession(req, res, userId) {
    const token = S.newToken(), t = now();
    q.insertSession.run(S.sha256(token), userId, t, t + cfg.sessionDays * 86400_000, String(req.get('user-agent') || '').slice(0, 200));
    setSessionCookie(req, res, token);
    return S.sha256(token);
  }

  app.use((req, res, next) => {                       // кто делает запрос?
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const key = S.sha256(token), row = q.session.get(key);
      if (row && row.expires_at > now()) {
        req.user = { id: row.id, username: row.username }; req.sessionKey = key;
        if (row.expires_at - now() < cfg.sessionDays * 43200_000) {   // продлеваем, когда осталось меньше половины срока
          q.extendSession.run(now() + cfg.sessionDays * 86400_000, key); setSessionCookie(req, res, token);
        }
      }
    }
    next();
  });

  // ---------- защита от CSRF для изменяющих запросов ----------
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'chat-editor') return res.status(403).json({ error: 'Запрос отклонён (CSRF).' });
    next();
  });
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const json = express.json({ limit: Math.ceil(cfg.maxProjectBytes) });
  const needAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Требуется вход.' }));
  const ip = req => req.ip || req.socket.remoteAddress || 'unknown';
  const wait = (res, s) => res.status(429).set('Retry-After', String(s)).json({ error: `Слишком много попыток. Повторите через ${Math.ceil(s / 60)} мин.` });

  // ---------- конфигурация и аккаунты ----------
  app.get('/api/config', (req, res) => res.json({ registration: cfg.registration, needCode: !!cfg.registrationCode }));

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Не выполнен вход.' });
    res.json({ user: req.user });
  });

  app.post('/api/register', json, async (req, res) => {
    try {
      if (cfg.registration === 'closed') return res.status(403).json({ error: 'Регистрация закрыта администратором.' });
      const w = limiter.hit('reg:' + ip(req), 10, 3600_000); if (w) return wait(res, w);
      const { username, password, code } = req.body || {};
      if (cfg.registrationCode && !S.safeEq(code || '', cfg.registrationCode)) return res.status(403).json({ error: 'Неверный код приглашения.' });
      if (typeof username !== 'string' || !USERNAME_RE.test(username)) return res.status(400).json({ error: 'Логин: 3–32 символа, латиница, цифры, «_», «-», «.».' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Пароль должен быть длиной от 8 до 200 символов.' });
      if (password.toLowerCase() === username.toLowerCase()) return res.status(400).json({ error: 'Пароль не должен совпадать с логином.' });
      if (q.userByName.get(username)) return res.status(409).json({ error: 'Такой логин уже занят.' });
      const info = q.insertUser.run(username, await S.hashPassword(password), now());
      q.touchLogin.run(now(), info.lastInsertRowid);
      createSession(req, res, info.lastInsertRowid);
      res.status(201).json({ user: { id: Number(info.lastInsertRowid), username } });
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Такой логин уже занят.' });
      console.error(e); res.status(500).json({ error: 'Ошибка сервера.' });
    }
  });

  app.post('/api/login', json, async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Введите логин и пароль.' });
      const k1 = 'login-ip:' + ip(req), k2 = 'login-u:' + username.toLowerCase();
      const w = Math.max(limiter.hit(k1, 30, 900_000), limiter.hit(k2, 8, 900_000)); if (w) return wait(res, w);
      const u = q.userByName.get(username);
      const ok = await S.verifyPassword(password, u ? u.pass : S.DUMMY) && !!u;
      if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль.' });
      limiter.clear(k2); q.touchLogin.run(now(), u.id); q.delExpired.run(now());
      createSession(req, res, u.id);
      res.json({ user: { id: u.id, username: u.username } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера.' }); }
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionKey) q.delSession.run(req.sessionKey);
    clearSessionCookie(req, res); res.json({ ok: true });
  });

  app.post('/api/password', needAuth, json, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body || {};
      const w = limiter.hit('pw:' + req.user.id, 10, 900_000); if (w) return wait(res, w);
      if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200) return res.status(400).json({ error: 'Новый пароль: от 8 до 200 символов.' });
      const u = q.userByName.get(req.user.username);
      if (!(await S.verifyPassword(String(oldPassword || ''), u.pass))) return res.status(403).json({ error: 'Текущий пароль указан неверно.' });
      q.setPass.run(await S.hashPassword(newPassword), u.id);
      q.delUserSessionsExcept.run(u.id, req.sessionKey);        // выйти на остальных устройствах
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера.' }); }
  });

  // ---------- проект пользователя: настройки + ситуации ----------
  app.get('/api/project', needAuth, (req, res) => {
    const uid = req.user.id, st = q.state.get(uid);
    if (!st) return res.json({ project: null, rev: 0 });
    const sits = q.sits.all(uid).map(r => JSON.parse(r.data));
    res.json({ project: { v: 2, settings: JSON.parse(st.settings), sa: st.active, sits, docs: q.docs.all(uid) }, rev: st.rev });
  });

  app.put('/api/project', needAuth, json, (req, res) => {
    const uid = req.user.id, { project: p, base } = req.body || {};
    if (!p || p.v !== 2 || !Array.isArray(p.sits) || typeof p.settings !== 'object' || p.settings === null) return res.status(400).json({ error: 'Некорректный формат проекта.' });
    if (p.sits.length > 500) return res.status(400).json({ error: 'Слишком много ситуаций (максимум 500).' });
    const ids = new Set();
    for (const s of p.sits) {
      if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id) || ids.has(s.id) || !Array.isArray(s.frames)) return res.status(400).json({ error: 'Некорректная ситуация в проекте.' });
      ids.add(s.id);
    }
    let docs = null;                                                         // публикации: если поле не прислано (старый клиент) — не трогаем
    if (p.docs !== undefined) {
      if (!Array.isArray(p.docs) || p.docs.length > 1000) return res.status(400).json({ error: 'Слишком много публикаций (максимум 1000).' });
      const dids = new Set();
      for (const d of p.docs) {
        if (!d || typeof d.id !== 'string' || !ID_RE.test(d.id) || dids.has(d.id) || typeof d.html !== 'string' || d.html.length > 4e6) return res.status(400).json({ error: 'Некорректная публикация в проекте.' });
        dids.add(d.id);
      }
      docs = { list: p.docs, ids: dids };
    }
    const t = now();
    const result = db.transaction(() => {
      const st = q.state.get(uid), rev = st ? st.rev : 0;
      if ((base ?? 0) !== rev) return { conflict: rev };                    // кто-то другой уже сохранил новую версию
      for (const [i, s] of p.sits.entries()) q.upsertSit.run({ uid, id: s.id, pos: i, name: String(s.name || '').slice(0, 200), data: JSON.stringify(s), t });
      for (const { id } of q.sitIds.all(uid)) if (!ids.has(id)) q.delSit.run(uid, id);
      if (docs) {
        for (const [i, d] of docs.list.entries()) q.upsertDoc.run({ uid, id: d.id, pos: i, kind: String(d.kind || 'other').slice(0, 20), title: String(d.title || '').slice(0, 200), html: d.html, t: Number(d.t) || t });
        for (const { id } of q.docIds.all(uid)) if (!docs.ids.has(id)) q.delDoc.run(uid, id);
      }
      q.upsertState.run({ uid, settings: JSON.stringify(p.settings), active: Math.max(0, Math.min(p.sits.length - 1, p.sa | 0)), rev: rev + 1, t });
      return { rev: rev + 1 };
    })();
    if (result.conflict !== undefined) return res.status(409).json({ error: 'Проект был изменён в другой вкладке или на другом устройстве.', rev: result.conflict });
    res.json({ rev: result.rev });
  });

  // ---------- картинки (скриншоты и слои) ----------
  const rawImage = express.raw({ type: () => true, limit: cfg.maxImageBytes });
  const checkId = (req, res, next) => (ID_RE.test(req.params.id) ? next() : res.status(400).json({ error: 'Некорректный id.' }));

  app.get('/api/images', needAuth, (req, res) => res.json({ ids: q.imgList.all(req.user.id).map(r => r.id) }));

  app.get('/api/images/:id', needAuth, checkId, (req, res) => {
    const r = q.imgGet.get(req.user.id, req.params.id);
    if (!r) return res.status(404).json({ error: 'Не найдено.' });
    res.set({ 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline' }).send(r.data);
  });

  app.put('/api/images/:id', needAuth, checkId, rawImage, (req, res) => {
    const uid = req.user.id, buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Пустой файл.' });
    if (q.imgInfo.get(uid, req.params.id)) return res.json({ id: req.params.id, existed: true });   // id неизменяемы — повторная загрузка безвредна
    const mime = S.sniffImage(buf);
    if (!mime) return res.status(415).json({ error: 'Поддерживаются PNG, JPEG, WebP, GIF, BMP и AVIF.' });
    const used = q.usedBytes.get(uid).n;
    if (used + buf.length > cfg.userQuotaBytes) return res.status(413).json({ error: 'Превышена квота хранилища. Удалите ненужные кадры или картинки.' });
    q.imgInsert.run(uid, req.params.id, mime, buf.length, buf, now());
    res.status(201).json({ id: req.params.id });
  });

  app.delete('/api/images/:id', needAuth, checkId, (req, res) => { q.imgDel.run(req.user.id, req.params.id); res.status(204).end(); });

  app.get('/api/usage', needAuth, (req, res) => {
    const u = q.usedBytes.get(req.user.id);
    res.json({ used: u.n, quota: cfg.userQuotaBytes, images: u.c, situations: q.sitCount.get(req.user.id).c });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Нет такого метода.' }));

  // ---------- интерфейс ----------
  app.use(express.static(cfg.publicDir, {
    index: 'index.html', etag: true,
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
  }));

  // ---------- ошибки ----------
  app.use((err, req, res, next) => {  // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON.' });
    console.error(err); res.status(500).json({ error: 'Ошибка сервера.' });
  });
  return app;
}

module.exports = { createApp };
