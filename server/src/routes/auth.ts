// Magic link auth routes — Supabase implementation
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { supabase } from '../lib/supabase.js';

const JWT_TTL = '7d'; // Session tokens last 7 days

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set');
  return secret;
}

const router = Router();

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// POST /api/auth/magic-link
// Body: { email: string }
router.post('/magic-link', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    console.error('[auth] SENDGRID_API_KEY is not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  // 1. Look up user by email (single indexed query, not paginated scan)
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (!user) {
    // Return the same response to avoid email enumeration
    console.log(`[auth] No account found for ${email} — sending generic response`);
    return res.json({ ok: true });
  }

  // 2. Generate token + expiry
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  // 3. Store on user record
  const { error: updateErr } = await supabase
    .from('users')
    .update({ magic_link: token, magic_link_expires: expiresAt })
    .eq('id', user.id);

  if (updateErr) {
    console.error('[auth] storeMagicLinkToken failed:', updateErr);
    return res.status(500).json({ error: 'Failed to generate login link' });
  }

  // 4. Build magic link URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const magicLink = `${frontendUrl}/login?link=${token}`;

  // 5. Send email via SendGrid
  const html = buildMagicLinkEmail(magicLink);

  const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sendgridKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: user.email }] }],
      from: { email: 'noreply@acquiro-agent.com', name: 'Acquiro' },
      subject: 'Sign in to Acquiro',
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!sgRes.ok) {
    const errText = await sgRes.text().catch(() => '');
    console.error(`[auth] SendGrid error ${sgRes.status}: ${errText.substring(0, 200)}`);
    return res.status(500).json({ error: 'Failed to send email' });
  }

  console.log(`[auth] Magic link sent to ${user.email}`);
  return res.json({ ok: true });
});

// GET /api/auth/verify?token=...
router.get('/verify', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token?.trim()) {
    return res.status(400).json({ error: 'token is required' });
  }

  // 1. Look up user by token
  const { data: user } = await supabase
    .from('users')
    .select('id, email, name, magic_link_expires')
    .eq('magic_link', token.trim())
    .single();

  if (!user) {
    return res.status(401).json({ error: 'LINK_EXPIRED' });
  }

  // 2. Check expiry
  if (!user.magic_link_expires || Date.now() > new Date(user.magic_link_expires).getTime()) {
    await supabase.from('users').update({ magic_link: null, magic_link_expires: null }).eq('id', user.id);
    return res.status(401).json({ error: 'LINK_EXPIRED' });
  }

  // 3. Clear the token (single-use)
  await supabase
    .from('users')
    .update({ magic_link: null, magic_link_expires: null })
    .eq('id', user.id)
    .then(({ error }) => {
      if (error) console.warn('[auth] clearMagicLinkToken failed (non-fatal):', error.message);
    });

  // Issue a signed session JWT so the client can prove identity on subsequent API calls
  const authToken = jwt.sign({ sub: user.id }, getJwtSecret(), { expiresIn: JWT_TTL });

  console.log(`[auth] Magic link verified for user ${user.id}`);
  return res.json({
    user_id: user.id,
    email: user.email,
    name: user.name ?? null,
    auth_token: authToken,
  });
});

function buildMagicLinkEmail(magicLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in to Acquiro</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 560px; margin: 0 auto; padding: 48px 24px; }
    .logo { font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; color: #c6ff4a; letter-spacing: -0.5px; margin-bottom: 40px; }
    .card { background-color: #141a13; border: 1px solid #2a3328; border-radius: 12px; padding: 40px; }
    h1 { color: #e8f5e0; font-size: 22px; font-weight: 600; margin: 0 0 12px 0; }
    p { color: #8fa882; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; }
    .btn { display: inline-block; background-color: #c6ff4a; color: #0b0f0a; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px; letter-spacing: 0.2px; }
    .link-fallback { margin-top: 28px; padding-top: 24px; border-top: 1px solid #2a3328; }
    .link-fallback p { font-size: 13px; color: #5a6e54; margin-bottom: 8px; }
    .link-fallback a { color: #8fa882; font-size: 12px; word-break: break-all; }
    .footer { margin-top: 32px; text-align: center; color: #3d4f38; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Acquiro</div>
    <div class="card">
      <h1>Sign in to Acquiro</h1>
      <p>Click the button below to sign in to your account. This link is valid for 15 minutes and can only be used once.</p>
      <a href="${magicLink}" class="btn">Sign in to Acquiro</a>
      <div class="link-fallback">
        <p>Button not working? Copy and paste this link into your browser:</p>
        <a href="${magicLink}">${magicLink}</a>
      </div>
    </div>
    <div class="footer">
      <p>If you didn&rsquo;t request this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

export default router;
