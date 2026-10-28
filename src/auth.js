// Security layer: scrypt password hashing + HMAC-signed bearer tokens (no external libs).
const crypto = require('crypto');
const { err } = require('./util');
const { db } = require('./db');

const SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 32);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function createToken(user) {
  const body = b64({ uid: user.id, role: user.role, exp: Date.now() + TTL_MS });
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch (_) {
    return null;
  }
}

// Express middleware: auth(['donor','admin']) or auth() for any logged-in user.
function auth(roles = []) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const payload = readToken(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!payload) return next(err(401, 'Please log in again'));
    const user = db.users.find((u) => u.id === payload.uid);
    if (!user) return next(err(401, 'Account not found'));
    if (roles.length && !roles.includes(user.role)) return next(err(403, 'Not allowed for your role'));
    req.user = user;
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createToken, auth };
