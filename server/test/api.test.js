'use strict';
// Запуск: npm test   (используется встроенный test-runner Node, без сторонних зависимостей)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-test-'));
process.env.DATA_DIR = tmp;
process.env.USER_QUOTA_MB = '1';           // маленькая квота для проверки
process.env.REGISTRATION_CODE = 'letmein';
process.env.PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const { createApp } = require('../src/app');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const H = { 'X-Requested-With': 'chat-editor' };
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, extra = {}) {
    const headers = { ...H, ...(this.cookie ? { Cookie: this.cookie } : {}), ...extra };
    let payload = body;
    if (body !== undefined && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + url, { method, headers, body: payload });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.endsWith('=')) this.cookie = ''; else this.cookie = kv; }
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  }
}

// минимальные валидные PNG (1x1) и «не-картинка»
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sit = (id, name) => ({ id, name, nick: 'N', pid: '1', frames: [{ name: 'Кадр 1', rows: [] }], active: 0, counter: 1 });
const project = sits => ({ v: 2, settings: { size: '13' }, sa: 0, sits });

test('конфигурация и защита по умолчанию', async () => {
  const c = new Client();
  assert.deepEqual((await c.call('GET', '/api/config')).data, { registration: 'open', needCode: true });
  assert.equal((await c.call('GET', '/api/me')).status, 401);
  assert.equal((await c.call('GET', '/api/project')).status, 401);
  const r = await fetch(base + '/api/logout', { method: 'POST' });            // без заголовка — CSRF
  assert.equal(r.status, 403);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('регистрация: проверки и успешный вход', async () => {
  const c = new Client();
  assert.equal((await c.call('POST', '/api/register', { username: 'alice', password: 'password123', code: 'wrong' })).status, 403);
  assert.equal((await c.call('POST', '/api/register', { username: 'a', password: 'password123', code: 'letmein' })).status, 400);
  assert.equal((await c.call('POST', '/api/register', { username: 'alice', password: 'short', code: 'letmein' })).status, 400);
  const ok = await c.call('POST', '/api/register', { username: 'alice', password: 'password123', code: 'letmein' });
  assert.equal(ok.status, 201); assert.equal(ok.data.user.username, 'alice');
  assert.equal((await c.call('GET', '/api/me')).data.user.username, 'alice');
  assert.equal((await new Client().call('POST', '/api/register', { username: 'ALICE', password: 'password123', code: 'letmein' })).status, 409);   // логин без учёта регистра
  await c.call('POST', '/api/logout');
  assert.equal((await c.call('GET', '/api/me')).status, 401);
  const c2 = new Client();
  assert.equal((await c2.call('POST', '/api/login', { username: 'alice', password: 'bad-password' })).status, 401);
  assert.equal((await c2.call('POST', '/api/login', { username: 'alice', password: 'password123' })).status, 200);
});

test('проект: сохранение, версии и конфликты', async () => {
  const c = new Client(); await c.call('POST', '/api/login', { username: 'alice', password: 'password123' });
  assert.deepEqual((await c.call('GET', '/api/project')).data, { project: null, rev: 0 });
  let r = await c.call('PUT', '/api/project', { project: project([sit('sit-aaaaaaaa', 'Первая'), sit('sit-bbbbbbbb', 'Вторая')]), base: 0 });
  assert.equal(r.status, 200); assert.equal(r.data.rev, 1);
  r = await c.call('GET', '/api/project');
  assert.equal(r.data.rev, 1); assert.deepEqual(r.data.project.sits.map(s => s.name), ['Первая', 'Вторая']);
  r = await c.call('PUT', '/api/project', { project: project([sit('sit-aaaaaaaa', 'Первая')]), base: 0 });        // устаревшая версия
  assert.equal(r.status, 409); assert.equal(r.data.rev, 1);
  r = await c.call('PUT', '/api/project', { project: project([sit('sit-bbbbbbbb', 'Вторая (изм.)'), sit('sit-aaaaaaaa', 'Первая')]), base: 1 });
  assert.equal(r.data.rev, 2);
  r = await c.call('GET', '/api/project');
  assert.deepEqual(r.data.project.sits.map(s => s.name), ['Вторая (изм.)', 'Первая']);                         // порядок сохраняется, удалённые пропадают
  assert.deepEqual((await c.call('GET', '/api/project/rev')).data, { rev: 2 });                                // лёгкая проверка версии
  assert.equal((await c.call('PUT', '/api/project', { project: { v: 2, sits: 'x' }, base: 2 })).status, 400);
  assert.equal((await c.call('PUT', '/api/project', { project: project([{ id: '../bad', frames: [] }]), base: 2 })).status, 400);
});

test('картинки: загрузка, проверка типа, квота, удаление', async () => {
  const c = new Client(); await c.call('POST', '/api/login', { username: 'alice', password: 'password123' });
  let r = await c.call('PUT', '/api/images/img-12345678', PNG, { 'Content-Type': 'image/png' });
  assert.equal(r.status, 201);
  assert.equal((await c.call('PUT', '/api/images/img-12345678', PNG, { 'Content-Type': 'image/png' })).data.existed, true);   // идемпотентно
  r = await c.call('GET', '/api/images/img-12345678');
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.ok(Buffer.compare(r.data, PNG) === 0);
  assert.equal((await c.call('PUT', '/api/images/img-87654321', Buffer.from('<html><script>alert(1)</script></html>'), { 'Content-Type': 'image/png' })).status, 415);
  assert.equal((await c.call('PUT', '/api/images/bad id', PNG)).status, 400);
  assert.deepEqual((await c.call('GET', '/api/images')).data.ids, ['img-12345678']);
  const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);                 // больше квоты в 1 МБ
  assert.equal((await c.call('PUT', '/api/images/img-big00000', big, { 'Content-Type': 'image/png' })).status, 413);
  const u = (await c.call('GET', '/api/usage')).data; assert.equal(u.images, 1); assert.equal(u.situations, 2);
  assert.equal((await c.call('DELETE', '/api/images/img-12345678')).status, 204);
  assert.equal((await c.call('GET', '/api/images/img-12345678')).status, 404);
});

test('изоляция данных между пользователями', async () => {
  const a = new Client(); await a.call('POST', '/api/login', { username: 'alice', password: 'password123' });
  await a.call('PUT', '/api/images/img-aaaaaaaa', PNG, { 'Content-Type': 'image/png' });
  const b = new Client();
  assert.equal((await b.call('POST', '/api/register', { username: 'bob', password: 'bobs-password', code: 'letmein' })).status, 201);
  assert.deepEqual((await b.call('GET', '/api/project')).data, { project: null, rev: 0 });
  assert.equal((await b.call('GET', '/api/images/img-aaaaaaaa')).status, 404);          // чужая картинка недоступна
  assert.deepEqual((await b.call('GET', '/api/images')).data.ids, []);
  await b.call('DELETE', '/api/images/img-aaaaaaaa');                                   // и удалить её нельзя
  assert.equal((await a.call('GET', '/api/images/img-aaaaaaaa')).status, 200);
  assert.equal((await b.call('PUT', '/api/project', { project: project([sit('sit-aaaaaaaa', 'Боб')]), base: 0 })).status, 200);   // тот же id ситуации у другого пользователя
  assert.equal((await a.call('GET', '/api/project')).data.project.sits.length, 2);
});

test('смена пароля завершает чужие сессии', async () => {
  const c1 = new Client(), c2 = new Client();
  await c1.call('POST', '/api/login', { username: 'bob', password: 'bobs-password' });
  await c2.call('POST', '/api/login', { username: 'bob', password: 'bobs-password' });
  assert.equal((await c1.call('POST', '/api/password', { oldPassword: 'nope', newPassword: 'new-password-1' })).status, 403);
  assert.equal((await c1.call('POST', '/api/password', { oldPassword: 'bobs-password', newPassword: 'new-password-1' })).status, 200);
  assert.equal((await c1.call('GET', '/api/me')).status, 200);
  assert.equal((await c2.call('GET', '/api/me')).status, 401);
  assert.equal((await new Client().call('POST', '/api/login', { username: 'bob', password: 'new-password-1' })).status, 200);
});

test('ограничение числа попыток входа', async () => {
  const c = new Client(); let last;
  for (let i = 0; i < 10; i++) last = await c.call('POST', '/api/login', { username: 'victim', password: 'x' + i });
  assert.equal(last.status, 429);
});
