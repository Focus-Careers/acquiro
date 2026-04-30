import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import checkoutRoutes from './routes/checkout.js';
import adminRoutes from './routes/admin.js';
import integrationsRoutes from './routes/integrations.js';
import emailRoutes from './routes/email.js';
import authRoutes from './routes/auth.js';
import bubbleRoutes from './routes/bubble.js';
import openaiRoutes from './routes/openai.js';
import scraperRoutes from './routes/scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env (multiple paths for local dev; Vercel injects env)
const envPaths = [
  resolve(__dirname, '../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'server/.env'),
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) break;
}
dotenv.config();

// Validate required environment variables (skip on Vercel build if not set yet)
const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID',
  'STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID',
];
const missingVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingVars.length > 0 && process.env.VERCEL !== '1') {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false; // non-browser clients (curl, Postman) blocked — not a legitimate CORS origin
  if (origin === FRONTEND_URL) return true;
  if (origin === 'https://acquirolabs.vercel.app') return true;
  // endsWith prevents substring-injection (e.g. evil-acquirolabs.vercel.app.attacker.com)
  if (origin.endsWith('.acquirolabs.vercel.app')) return true; // preview deployments
  // Anchored localhost check — any port, http or https
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

// Rate limiters — applied after CORS so rejected origins never consume a slot
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit exceeded, please try again later.' },
});

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) {
        cb(null, true);
      } else {
        console.warn('[CORS] Rejected origin:', origin);
        cb(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
// Stripe webhook needs the raw request body for signature verification.
// Must be registered BEFORE express.json() so this route gets Buffer, not parsed object.
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use(globalLimiter);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Acquiro Backend API', health: '/health', checkout: '/api/checkout' });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/checkout', checkoutRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/bubble', bubbleRoutes);
app.use('/api/openai', aiLimiter, openaiRoutes);
app.use('/api/scraper', scraperRoutes);

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
