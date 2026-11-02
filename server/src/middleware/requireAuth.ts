/**
 * Auth middleware — JWT verification.
 *
 * Every protected route must call requireAuth first.
 * On success, req.userId is populated with the authenticated user's ID.
 * On failure, 401 is returned and the route handler never runs.
 *
 * Tokens are issued by POST /api/auth/verify (magic link verify endpoint).
 * They are signed with JWT_SECRET (HS256) and expire after 7 days.
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

/**
 * The user id from a valid bearer token, or null after responding.
 *
 * A missing JWT_SECRET is a server fault, not a bad token, so it answers 500 and logs rather than
 * 401. Otherwise an unconfigured deploy turns every protected route into "invalid or expired
 * token" — indistinguishable from a client problem, and on Vercel the startup env check that would
 * have caught it is skipped.
 *
 * The algorithm is pinned to HS256, the only one this service signs with.
 */
function authenticatedUserId(req: Request, res: Response): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[auth] JWT_SECRET is not set — every protected route is failing');
    res.status(500).json({ error: 'Authentication is not configured on the server' });
    return null;
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub?: string };
    if (!payload?.sub) {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    }
    return payload.sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

/** Require a valid JWT. Populates req.userId. Returns 401 otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = authenticatedUserId(req, res);
  if (userId === null) return;
  req.userId = userId;
  next();
}

/**
 * Require a valid JWT AND that the user is an admin.
 * Does a single indexed DB lookup to check is_admin — avoids stale JWT claims.
 * Populates req.userId and req.isAdmin = true.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = authenticatedUserId(req, res);
  if (userId === null) return;

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
