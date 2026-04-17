import { Router } from 'express';
import { verifyPassword, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.json({ token: signToken() });
});

export default router;
