import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const INSECURE_JWT_DEFAULTS = new Set(['default-secret-change-me', 'change-me-in-production', '']);

function loadJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || INSECURE_JWT_DEFAULTS.has(secret)) {
    throw new Error('JWT_SECRET is missing or set to a known-insecure default. Set JWT_SECRET in .env (e.g. `openssl rand -hex 32`).');
  }
  if (secret.length < 32) {
    throw new Error(`JWT_SECRET is only ${secret.length} characters; require at least 32.`);
  }
  return secret;
}

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!DASHBOARD_PASSWORD || DASHBOARD_PASSWORD === 'radar' || DASHBOARD_PASSWORD === 'strong_password_here') {
  throw new Error('DASHBOARD_PASSWORD is missing or set to a known-insecure default. Set a strong password in .env.');
}

const JWT_SECRET = loadJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const passwordHash = bcrypt.hashSync(DASHBOARD_PASSWORD, 10);

export function verifyPassword(password) {
  return typeof password === 'string' && bcrypt.compareSync(password, passwordHash);
}

export function signToken(payload = { role: 'admin' }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ') && header.slice(7) !== 'null') {
    token = header.slice(7);
  } else {
    token = readCookie(req, 'token');
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
