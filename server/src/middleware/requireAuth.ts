/**
 * Auth middleware — JWT verification.
 *
 * Every protected route must call requireAuth first.
 * On success, req.userId is populated with the authenticated user's ID.
 * On failure, 401 is returned and the route handler never runs.
 *
 * Tokens are issued by POST /api/auth/verify (magic link verify endpoint).
 * They are signed with JWT_SECRET and expire after 7 days.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../lib/supabase.js';

// Augment Express Request so route handlers get type-safe access to userId / isAdmin
declare global {
  namespace Express {
    interface Request {
      userId: string;
      isAdmin?: boolean;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set');
  return secret;
}

/** Require a valid JWT. Populates req.userId. Returns 401 otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string };
    if (!payload?.sub) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require a valid JWT AND that the user is an admin.
 * Does a single indexed DB lookup to check is_admin — avoids stale JWT claims.
 * Populates req.userId and req.isAdmin = true.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string };
    if (!payload?.sub) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    userId = payload.sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Check is_admin from DB (not from JWT claims, so it stays accurate if admin status changes)
  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', userId)
    .single();

  if (!user?.is_admin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  req.userId = userId;
  req.isAdmin = true;
  next();
}
