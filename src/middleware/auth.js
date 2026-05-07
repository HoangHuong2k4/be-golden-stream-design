import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme_secret_key';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware: Require valid JWT
 */
export async function authMiddleware(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    c.set('user', payload);
    await next();
  } catch (e) {
    return c.json({ error: 'Token không hợp lệ hoặc đã hết hạn' }, 401);
  }
}

/**
 * Middleware: Require ADMIN role
 */
export async function adminMiddleware(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'ADMIN') {
    return c.json({ error: 'Forbidden - Admin only' }, 403);
  }
  await next();
}
