import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'radar';
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const passwordHash = bcrypt.hashSync(DASHBOARD_PASSWORD, 10);

export function verifyPassword(password) {
  return typeof password === 'string' && bcrypt.compareSync(password, passwordHash);
}

export function signToken(payload = { role: 'admin' }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
