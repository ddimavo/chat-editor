'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

// «пустой» хэш — чтобы время ответа не выдавало, существует ли такой пользователь
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Простое ограничение числа попыток (в памяти процесса). */
class RateLimiter {
  constructor() { this.m = new Map(); setInterval(() => this.sweep(), 60_000).unref(); }
  /** 0 — можно; иначе число секунд до следующей попытки */
  hit(key, limit, windowMs) {
    const now = Date.now();
    let e = this.m.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; this.m.set(key, e); }
    e.n++;
    return e.n <= limit ? 0 : Math.ceil((e.reset - now) / 1000);
  }
  clear(key) { this.m.delete(key); }
  sweep() { const now = Date.now(); for (const [k, e] of this.m) if (e.reset < now) this.m.delete(k); }
}

/** Определяет тип картинки по первым байтам — на заявленный Content-Type не полагаемся. */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && /avif|avis/.test(buf.toString('latin1', 8, 16))) return 'image/avif';
  return null;
}

module.exports = { hashPassword, verifyPassword, DUMMY, sha256, newToken, safeEq, RateLimiter, sniffImage };
