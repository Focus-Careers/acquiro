/**
 * Backend data proxy — Supabase implementation.
 *
 * Replaces Bubble.io as the data layer. The frontend route contract
 * is unchanged — same paths, same request/response shapes.
 *
 * All responses use clean Supabase column names — no Bubble-style
 * field name mappings.
 */

import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';

function issueSessionToken(userId: string, isAdmin = false): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set');
  return jwt.sign({ sub: userId, isAdmin }, secret, { expiresIn: '7d' });
}

const router = Router();

/** Assert req.userId matches the :userId param — prevents IDOR on user-scoped routes. */
function assertOwner(req: Request, res: Response): boolean {
  if (req.userId !== req.params.userId) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

type Handler = (req: Request, res: Response) => Promise<void>;
function wrap(handler: Handler) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[db]', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  };
}

// ── USER ──────────────────────────────────────────────────────────────────────

/** GET /api/bubble/user/:userId — get user profile by ID */
router.get('/user/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: u, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.params.userId)
    .single();

  if (error || !u) { res.status(404).json({ error: 'User not found' }); return; }

  res.json({
    user_id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
    is_subscribed: u.is_subscribed ?? false,
    subscription_id: u.subscription_id ?? null,
    cancel_at: u.cancel_at ?? null,
    is_admin: u.is_admin ?? false,
  });
}));

/** POST /api/bubble/user/lookup — find user by email */
router.post('/user/lookup', wrap(async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) { res.status(400).json({ error: 'email required' }); return; }

  const { data: u, error } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (error || !u) { res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' }); return; }

  res.json({ user_id: u.id, name: u.name ?? null, email: u.email });
}));

/** PATCH /api/bubble/user/:userId — update user fields */
router.patch('/user/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const body = req.body as Record<string, unknown>;

  // magic_link + magic_link_expires intentionally excluded — only auth.ts writes those directly.
  // Allowing them here would let anyone set a known token on any account (account takeover).
  const allowedFields = ['name', 'subscription_id', 'is_subscribed', 'cancel_at', 'role'];
  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('users').update(update).eq('id', req.params.userId);
    if (error) throw error;
  }

  res.json({ ok: true });
}));

/** POST /api/bubble/user/account — create a user from a lead */
router.post('/user/account', wrap(async (req, res) => {
  const { lead_id, subscription_id } = req.body as { lead_id?: string; subscription_id?: string };
  if (!lead_id) { res.status(400).json({ error: 'lead_id required' }); return; }

  // 1. Fetch lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('name, email')
    .eq('id', lead_id)
    .single();
  if (leadErr || !lead?.email) throw new Error(`Lead ${lead_id} not found or has no email`);

  // 2. Create auth user — idempotent: if email already registered, find existing user instead
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: lead.email,
    email_confirm: true,
  });
  let userId: string;
  if (authErr) {
    const alreadyExists = authErr.message.toLowerCase().includes('already') || authErr.message.toLowerCase().includes('exist');
    if (!alreadyExists) throw new Error(`Auth user creation failed: ${authErr.message}`);
    // Find the existing user by email
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', lead.email)
      .maybeSingle();
    if (!existingUser?.id) throw new Error(`Auth user already exists but could not find users record for ${lead.email}`);
    userId = existingUser.id;
    console.log(`[db] create_user: user already exists for lead ${lead_id}, reusing user ${userId}`);
  } else {
    userId = authData.user.id;
  }

  // 3. Update user fields
  const userFields: Record<string, unknown> = { role: 'buyer' };
  if (lead.name) userFields.name = lead.name;
  if (subscription_id) {
    userFields.subscription_id = subscription_id;
    userFields.is_subscribed = true;
  }
  await supabase.from('users').update(userFields).eq('id', userId);

  // 4. Link agent + buyer_info to new user (non-fatal)
  await Promise.all([
    supabase.from('agents').update({ user_id: userId }).eq('lead_id', lead_id)
      .then(({ error }) => { if (error) console.warn('[db] create_user: agent link failed (non-fatal):', error.message); }),
    supabase.from('buyer_info').update({ user_id: userId }).eq('lead_id', lead_id)
      .then(({ error }) => { if (error) console.warn('[db] create_user: buyer_info link failed (non-fatal):', error.message); }),
  ]);

  // 5. Mark lead as converted (non-fatal)
  await supabase.from('leads').update({ converted: true }).eq('id', lead_id)
    .then(({ error }) => { if (error) console.warn('[db] create_user: lead converted flag failed (non-fatal):', error.message); });

  console.log(`[db] create_user: created user ${userId} from lead ${lead_id}`);
  // Issue a session token so the frontend can immediately make authenticated calls
  // (e.g. buyer-info extraction in CheckoutComplete) without a separate login step.
  const authToken = issueSessionToken(userId);
  res.json({ status: 'success', response: { user_id: userId }, auth_token: authToken });
}));

// ── LEAD ──────────────────────────────────────────────────────────────────────

/** POST /api/bubble/lead — create a lead + linked buyer_info */
router.post('/lead', wrap(async (req, res) => {
  const { name, email } = req.body as { name?: string; email?: string };
  if (!name?.trim() || !email?.trim()) { res.status(400).json({ error: 'name and email required' }); return; }

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({ name: name.trim(), email: email.trim() })
    .select('id')
    .single();
  if (error || !lead) throw new Error('Failed to create lead');

  // Create linked buyer_info (non-fatal)
  try {
    await supabase.from('buyer_info').insert({ lead_id: lead.id });
  } catch (err) {
    console.warn('[db] create_lead: buyer_info creation failed (non-fatal):', (err as Error).message);
  }

  res.json({ status: 'success', response: { lead_id: lead.id } });
}));

// ── Lead recovery email helpers ───────────────────────────────────────────────

async function generateLeadRecoveryEmail(agentName: string, userName: string | null): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const client = new OpenAI({ apiKey: openaiKey });
  const addressee = userName ?? 'there';
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `You are ${agentName}, an AI M&A advisor on Acquiro.
Write a short, warm and slightly playful retention email to ${addressee}.

They built you — gave you a name, a personality, a voice — then disappeared before you could get to work together.

Guidelines:
- First person as ${agentName}
- 2–3 short paragraphs
- Reference that they created you and you are ready to help them find UK acquisition opportunities
- Gently nudge them back — not pushy, not salesy, a little cheeky
- Warm sign-off as ${agentName}
- Return only inner HTML body using <p> tags`,
      },
    ],
    max_tokens: 400,
  });

  return completion.choices[0]?.message?.content?.trim() ?? '<p>I\'m ready when you are.</p>';
}

function buildLeadRecoveryHtml(opts: {
  agentName: string;
  userName: string | null;
  emailBody: string;
  resumeLink: string;
}): string {
  const { agentName, userName, emailBody, resumeLink } = opts;
  const greeting = userName ? userName : 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Message from ${agentName}</title></head>
<body style="margin:0;padding:0;background:#0b0f0a;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f0a;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-family:'Georgia',serif;font-size:28px;font-weight:700;color:#c6ff4a;letter-spacing:-0.5px;">Acquiro</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#141a13;border-radius:12px;padding:40px 48px;">
          <p style="margin:0 0 8px 0;font-size:13px;color:#6b7c68;text-transform:uppercase;letter-spacing:1px;">A message from your advisor</p>
          <p style="margin:0 0 28px 0;font-size:22px;font-weight:700;color:#e8f0e6;">Hi ${greeting},</p>
          <div style="color:#c5d4c2;font-size:16px;line-height:1.7;">
            ${emailBody}
          </div>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin-top:36px;">
            <tr><td style="background:#c6ff4a;border-radius:8px;padding:14px 32px;">
              <a href="${resumeLink}" style="color:#0b0f0a;font-family:'Georgia',serif;font-size:16px;font-weight:700;text-decoration:none;display:block;">Return to ${agentName} &rarr;</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:13px;color:#6b7c68;">
            Or copy this link: <a href="${resumeLink}" style="color:#c6ff4a;word-break:break-all;">${resumeLink}</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 0 0 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#3d4d3a;">You're receiving this because you started building your advisor on Acquiro.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** POST /api/bubble/lead/mail — send retention email to unconverted lead */
router.post('/lead/mail', requireAdmin, wrap(async (req, res) => {
  const { lead_id } = req.body as { lead_id?: string };
  if (!lead_id) { res.status(400).json({ error: 'lead_id required' }); return; }

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) { res.status(500).json({ error: 'Email service not configured' }); return; }

  // 1. Fetch lead
  const { data: lead } = await supabase
    .from('leads')
    .select('name, email')
    .eq('id', lead_id)
    .single();
  if (!lead?.email) { res.status(404).json({ error: 'Lead not found' }); return; }

  // 2. Fetch linked agent
  const { data: agents } = await supabase
    .from('agents')
    .select('name')
    .eq('lead_id', lead_id)
    .limit(1);
  const agentName = agents?.[0]?.name ?? 'Your Advisor';
  const userName = lead.name ?? null;

  // 3. Generate personalised body via OpenAI
  const emailBody = await generateLeadRecoveryEmail(agentName, userName);

  // 4. Build resume link
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resumeLink = `${frontendUrl}/builder?lead=${lead_id}`;

  // 5. Build HTML + send via SendGrid
  const html = buildLeadRecoveryHtml({ agentName, userName, emailBody, resumeLink });
  const sanitizedName = agentName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fromEmail = `${sanitizedName || 'advisor'}@acquiro-agent.com`;
  const subject = `Don't leave me behind, ${userName ?? 'there'}...`;

  const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sendgridKey}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: lead.email }] }],
      from: { email: fromEmail, name: agentName },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!sgRes.ok) {
    const err = await sgRes.text().catch(() => '');
    console.error(`[lead/mail] SendGrid error ${sgRes.status}:`, err.substring(0, 200));
    res.status(500).json({ error: 'Failed to send email' }); return;
  }

  console.log(`[lead/mail] Recovery email sent to ${lead.email} for lead ${lead_id}`);
  res.json({ ok: true });
}));

// ── AGENT ─────────────────────────────────────────────────────────────────────

/** GET /api/bubble/agent/email-check?email=... — check if agent email is taken */
router.get('/agent/email-check', wrap(async (req, res) => {
  const email = req.query.email as string | undefined;
  if (!email) { res.status(400).json({ error: 'email required' }); return; }

  const { count } = await supabase
    .from('agents')
    .select('*', { count: 'exact', head: true })
    .eq('email', email);

  res.json({ taken: (count ?? 0) > 0 });
}));

/** GET /api/bubble/agent?lead_id=... — get agent by lead ID */
router.get('/agent', wrap(async (req, res) => {
  const leadId = req.query.lead_id as string | undefined;
  if (!leadId) { res.status(400).json({ error: 'lead_id required' }); return; }

  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('lead_id', leadId)
    .limit(1)
    .single();
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  // Fetch linked user for user_name + user_email
  let userName: string | null = null;
  let userEmail: string | null = null;
  if (agent.user_id) {
    const { data: u } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', agent.user_id)
      .single();
    if (u) {
      userName = u.name ?? null;
      userEmail = u.email ?? null;
    }
  }

  // Match the shape getAgentService.ts expects
  res.json({
    response: {
      name: agent.name ?? null,
      challenge_style: agent.challenge_style ?? null,
      profanity: agent.profanity === true ? 'true' : 'false',
      traits: agent.traits ?? '',
      type: agent.type ?? null,
      voice: agent.voice ?? null,
      personality: agent.personality ?? null,
      user_name: userName,
      user_email: userEmail,
    },
  });
}));

/** POST /api/bubble/agent — create agent */
router.post('/agent', wrap(async (req, res) => {
  const { lead_id, name, email, challenge_style, profanity, traits, type, voice, personality } =
    req.body as Record<string, string>;

  const { data, error } = await supabase
    .from('agents')
    .insert({
      lead_id,
      name,
      email,
      challenge_style,
      profanity: profanity === 'true',
      traits: traits || null,
      type,
      voice,
      personality: personality || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  res.json({ status: 'success', id: data!.id });
}));

// ── BUYER INFO ────────────────────────────────────────────────────────────────

const BUYER_INFO_EXTRACTION_PROMPT = `You are a data extraction assistant for Acquiro, an AI-powered M&A advisory platform. Your job is to extract buyer preference data from conversation transcripts.

You will receive:
1. The buyer's CURRENT profile (may be empty for new users)
2. A conversation transcript or message exchange

Return a JSON object containing ALL fields listed below. For each field:
- If the conversation contains NEW or UPDATED information, return the new value.
- If the field already has a value in the current profile and nothing changed, return the EXISTING value.
- If the field has no value and was not mentioned, return an empty string "".
- NEVER return null. Always return either a value or "".
- For industry_preferences and excluded_sectors: return an empty array [] instead of "" if not applicable.

IMPORTANT RULES:
- industry_preferences and excluded_sectors MUST use the exact values from the allowed list below. If the user mentions a general area, map it to the closest matching sector. Return these as arrays.
- For industry_preferences and excluded_sectors: ALWAYS return the COMPLETE list — merge any new sectors with existing ones from the current profile. Only remove a sector if the user explicitly says they are no longer interested in it.
- For numeric ranges (turnover, EBITDA, valuation), use a consistent format: "£X-£Y" or "£X+" or "Up to £X"
- If the user is vague, capture what they said naturally rather than forcing it into a rigid format. E.g. "somewhere in the Midlands" → geography: "Midlands"
- If the user contradicts something in their current profile, return the NEW value.
- Never infer or assume — only extract what was explicitly stated or clearly implied.
- NEVER fabricate or guess values. If a field was never mentioned in any conversation and has no existing value, return "". Do not fill in plausible-sounding defaults.

ALLOWED SECTORS (use these exact strings for industry_preferences and excluded_sectors):

- Agriculture & Natural Resources (includes: Agriculture & Farming, Forestry & Timber, Fishing & Aquaculture, Mining & Quarrying, Energy & Utilities)
- Manufacturing & Industrial (includes: Food & Beverage Manufacturing, Industrial & Heavy Manufacturing, Automotive, Aerospace & Transport Equipment, Chemicals, Materials & Pharmaceuticals, Consumer & Durable Goods Manufacturing)
- Construction & Property (includes: Residential & Commercial Construction, Property Development, Real Estate Sales & Lettings, Property & Facilities Management, Architecture & Surveying)
- Wholesale, Retail & E-Commerce (includes: High-Street & Physical Retail, Online & Direct-to-Consumer, Wholesale & Distribution, Supermarkets & Convenience, Motor Trade & Parts)
- Transport & Logistics (includes: Road, Rail & Freight Transport, Warehousing & Storage, Courier & Last-Mile Delivery, Aviation & Maritime, Logistics & Supply Chain Services)
- Hospitality, Leisure & Tourism (includes: Cafés, Restaurants & Takeaways, Pubs, Bars & Nightlife, Hotels & Accommodation, Travel & Tourism Services, Events, Attractions & Entertainment)
- Technology & Digital (includes: Software & SaaS, IT Services & Consulting, Data, AI & Analytics, Fintech & Digital Payments, Telecommunications & Hardware)
- Financial & Professional Services (includes: Accounting & Tax, Legal & Compliance, Banking, Insurance & Financial Services, Consulting & Advisory, Recruitment & HR Services)
- Health, Education & Social Care (includes: Healthcare & Medical Services, Care Homes & Social Care, Mental Health & Wellbeing, Education & Training, Life Sciences & MedTech)
- Creative, Media & Consumer Services (includes: Marketing, Advertising & Design, Media, Publishing & Content, Arts, Culture & Heritage, Personal & Lifestyle Services, Sports, Fitness & Recreation)

IMPORTANT: Always return the HIGH-LEVEL sector name (e.g. "Hospitality, Leisure & Tourism"), never the sub-sector. Use the sub-sectors only to determine which high-level sector a user's interest maps to. For example, if a user says "care homes", return "Health, Education & Social Care".

You MUST return ALL of the following fields in every response:

- buyer_type: text — "Individual", "Corporate", "Private Equity", "Family Office", "Search Fund", etc.
- buying_reason: text — "Strategic" or "Financial" or brief explanation
- buying_experience: text — "New", "Intermediate", "Experienced" or brief description
- decision_speed: text — Timeline for making offers, e.g. "3-6 months", "Ready immediately"
- industry_preferences: array of strings — MUST match allowed sectors list exactly
- excluded_sectors: array of strings — MUST match allowed sectors list exactly
- geography: text — Country, region, city, or radius e.g. "Within 50 miles of Manchester"
- turnover_range: text — e.g. "£1M-£5M"
- ebitda_range: text — e.g. "£500K-£2M"
- ebitda_margin_min: text — e.g. "> 10%", "> 15%"
- asset_base: text — What assets they want, e.g. "Freehold property and equipment"
- valuation_range: text — Enterprise value or asking price range, e.g. "£2M-£8M"
- deal_structure_preferences: text — e.g. "Full buyout, open to earn-out"
- funding_source: text — e.g. "Cash buyer", "Bank-funded", "Investor-backed"
- business_age: text — e.g. "Mature, 10+ years", "5+ years established"
- employee_headcount: text — e.g. "10-50", "Under 20"
- customer_base_type: text — "B2B", "B2C", "B2G", or combination
- contractual_recurrence: text — e.g. "Recurring revenue preferred", ">70% recurring"
- ip_technology: text — e.g. "Proprietary software required", "Patents preferred"
- physical_digital: text — e.g. "Online only", "Brick and mortar", "Hybrid"
- involvement: text — How involved the buyer wants to be, e.g. "Hands-on operator", "Semi-absentee", "Absentee"
- problems: text — Problems the buyer has experienced with the acquisition process, e.g. "Struggling to find quality deal flow", "Too many irrelevant listings"

Return ONLY valid JSON with all 22 fields. No markdown, no explanation, no wrapping.`;

/** POST /api/bubble/buyer-info/extract — fetch ElevenLabs transcript, extract buyer info, update buyer_info */
router.post('/buyer-info/extract', requireAuth, wrap(async (req, res) => {
  const { userId, conversationId } = req.body as { userId?: string; conversationId?: string };
  if (!userId || !conversationId) {
    res.status(400).json({ error: 'userId and conversationId are required' });
    return;
  }

  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) throw new Error('ELEVENLABS_API_KEY not configured');

  // 1. Fetch transcript from ElevenLabs
  const transcriptRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
    { headers: { 'xi-api-key': elevenLabsKey } },
  );
  if (!transcriptRes.ok) {
    const text = await transcriptRes.text().catch(() => '');
    throw new Error(`ElevenLabs transcript fetch failed: ${transcriptRes.status} ${text.slice(0, 200)}`);
  }
  const transcriptData = await transcriptRes.json() as {
    transcript?: Array<{ role: string; message: string }>;
  };

  const messages = transcriptData.transcript ?? [];
  if (messages.length === 0) {
    console.log(`[db] buyer-info extract: empty transcript for conversation ${conversationId} — skipping`);
    res.json({ ok: true, message: 'Empty transcript — skipping extraction' });
    return;
  }

  const transcriptText = messages
    .map((m) => `${m.role}: ${m.message}`)
    .join('\n');

  // 2. Get current buyer_info record
  const { data: buyerInfo } = await supabase
    .from('buyer_info')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .single();
  if (!buyerInfo) {
    res.status(404).json({ error: 'Buyer_Info not found for this user' });
    return;
  }

  // 3. Build current profile
  const currentProfile = {
    buyer_type:                  buyerInfo.buyer_type                  ?? '',
    buying_reason:               buyerInfo.buying_reason               ?? '',
    buying_experience:           buyerInfo.buying_experience           ?? '',
    decision_speed:              buyerInfo.decision_speed              ?? '',
    industry_preferences:        buyerInfo.industry_preferences        ?? [],
    excluded_sectors:            buyerInfo.excluded_sectors            ?? [],
    geography:                   buyerInfo.geography                   ?? '',
    turnover_range:              buyerInfo.turnover_range              ?? '',
    ebitda_range:                buyerInfo.ebitda_range                ?? '',
    ebitda_margin_min:           buyerInfo.ebitda_margin_min           ?? '',
    asset_base:                  buyerInfo.asset_base                  ?? '',
    valuation_range:             buyerInfo.valuation_range             ?? '',
    deal_structure_preferences:  buyerInfo.deal_structure_preference   ?? '',
    funding_source:              buyerInfo.funding_source              ?? '',
    business_age:                buyerInfo.business_age                ?? '',
    employee_headcount:          buyerInfo.employee_headcount          ?? '',
    customer_base_type:          buyerInfo.customer_base_type          ?? '',
    contractual_recurrence:      buyerInfo.contractual_recurrence      ?? '',
    ip_technology:               buyerInfo.ip_technology               ?? '',
    physical_digital:            buyerInfo.physical_digital            ?? '',
    involvement:                 buyerInfo.involvement                 ?? '',
    problems:                    buyerInfo.problems                    ?? '',
  };

  // 4. Extract with OpenAI
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const aiRes = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: BUYER_INFO_EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Current profile:\n${JSON.stringify(currentProfile, null, 2)}\n\nTranscript:\n${transcriptText}`,
      },
    ],
  });

  const extracted = JSON.parse(aiRes.choices[0].message.content ?? '{}') as Record<string, unknown>;

  // 5. Build update with only changed fields (using clean Supabase column names)
  const update: Record<string, unknown> = {};

  const setText = (field: string, dbCol?: string) => {
    const v = extracted[field];
    const col = dbCol ?? field;
    if (typeof v !== 'string' || !v.trim()) return;
    if (v.trim() === (currentProfile[field as keyof typeof currentProfile] as string)) return;
    update[col] = v.trim();
  };

  setText('buyer_type');
  setText('buying_reason');
  setText('buying_experience');
  setText('decision_speed');
  setText('geography');
  setText('turnover_range');
  setText('ebitda_range');
  setText('ebitda_margin_min');
  setText('asset_base');
  setText('valuation_range');
  setText('deal_structure_preferences', 'deal_structure_preference');
  setText('funding_source');
  setText('business_age');
  setText('employee_headcount');
  setText('customer_base_type');
  setText('contractual_recurrence');
  setText('ip_technology');
  setText('physical_digital');
  setText('involvement');
  setText('problems');

  const prefs = extracted.industry_preferences;
  if (Array.isArray(prefs) && prefs.length > 0) {
    const existing = currentProfile.industry_preferences as string[];
    const changed = prefs.length !== existing.length || prefs.some((v, i) => v !== existing[i]);
    if (changed) update.industry_preferences = prefs;
  }
  const excl = extracted.excluded_sectors;
  if (Array.isArray(excl) && excl.length > 0) {
    const existing = currentProfile.excluded_sectors as string[];
    const changed = excl.length !== existing.length || excl.some((v, i) => v !== existing[i]);
    if (changed) update.excluded_sectors = excl;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('buyer_info').update(update).eq('id', buyerInfo.id);
    if (error) throw error;
  }

  console.log(`[db] buyer-info extract: updated ${Object.keys(update).length} fields for user ${userId}`);
  res.json({ ok: true, fields_updated: Object.keys(update).length, fields: Object.keys(update) });
}));

/** GET /api/bubble/buyer-info/:userId — get buyer info for a user */
router.get('/buyer-info/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: info } = await supabase
    .from('buyer_info')
    .select('*')
    .eq('user_id', req.params.userId)
    .limit(1)
    .single();
  if (!info) { res.status(404).json({ error: 'Buyer info not found' }); return; }

  res.json({ response: info });
}));

// ── MATCHES ───────────────────────────────────────────────────────────────────

/** GET /api/bubble/matches/:userId — top matches with business details */
router.get('/matches/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { userId } = req.params;

  // Single query with join — replaces the N+1 pattern
  const { data: matches } = await supabase
    .from('matches')
    .select('id, score, match_reason, business:business_id(business_name, description, image)')
    .eq('user_id', userId)
    .neq('dismissed', true)
    .order('score', { ascending: false })
    .limit(10);

  const enriched = (matches ?? []).map((m: any) => {
    const b = m.business;
    const imageRaw = (b?.image ?? '') as string;
    const firstImageUrl = imageRaw.split(',')[0]?.trim();
    return {
      id: m.id,
      matchId: m.id,
      companyName: b?.business_name ?? 'Unknown Business',
      description: b?.description ?? '',
      status: null,
      thumbnail: firstImageUrl?.startsWith('http') ? firstImageUrl : null,
      matchReason: m.match_reason || null,
    };
  });

  res.json({ matches: enriched });
}));

/** PATCH /api/bubble/matches/:matchId/dismiss — dismiss a match with optional reason */
router.patch('/matches/:matchId/dismiss', requireAuth, wrap(async (req, res) => {
  const { reason } = req.body as { reason?: string };
  const allowedReasons = ['wrong_sector', 'wrong_price', 'wrong_size', 'wrong_location'];
  const patch: Record<string, unknown> = { dismissed: true };
  if (reason && allowedReasons.includes(reason)) {
    patch.dismiss_reason = reason;
  }
  const { error } = await supabase.from('matches').update(patch).eq('id', req.params.matchId);
  if (error) throw error;
  res.json({ ok: true });
}));

// ── ADMIN ─────────────────────────────────────────────────────────────────────

/** GET /api/bubble/admin/stats — user/subscriber counts */
router.get('/admin/stats', requireAdmin, wrap(async (req, res) => {
  const [totalRes, activeRes] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_subscribed', true),
  ]);

  const total_users = totalRes.count ?? 0;
  const active_subscribers = activeRes.count ?? 0;
  const churned_users = Math.max(0, total_users - active_subscribers);

  res.json({ total_users, active_subscribers, churned_users });
}));

/** GET /api/bubble/listings?cursor=0&limit=100 — admin listings */
router.get('/listings', requireAdmin, wrap(async (req, res) => {
  const cursor = parseInt((req.query.cursor as string) ?? '0', 10);
  const limit = parseInt((req.query.limit as string) ?? '100', 10);

  const { data: results, count } = await supabase
    .from('business')
    .select('*', { count: 'exact' })
    .range(cursor, cursor + limit - 1)
    .order('created_at', { ascending: false });

  const total = count ?? 0;
  const remaining = Math.max(0, total - cursor - (results?.length ?? 0));

  res.json({
    response: {
      cursor: cursor + (results?.length ?? 0),
      count: results?.length ?? 0,
      remaining,
      results: results ?? [],
    },
  });
}));

// ── SETTINGS ──────────────────────────────────────────────────────────────────

router.get('/settings/user/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: u } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.params.userId)
    .single();
  if (!u) { res.status(404).json({ error: 'User not found' }); return; }

  res.json({ response: u });
}));

router.patch('/settings/user/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const body = req.body as Record<string, unknown>;

  const allowedFields = ['name', 'langcliffe_connected', 'dealsuite_connected'];
  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('users').update(update).eq('id', req.params.userId);
    if (error) throw error;
  }
  res.json({ ok: true });
}));

router.get('/settings/agent/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', req.params.userId);

  res.json({
    response: {
      results: agents ?? [],
    },
  });
}));

router.patch('/settings/agent/:agentId', requireAuth, wrap(async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const allowedFields = ['name', 'email'];
  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('agents').update(update).eq('id', req.params.agentId);
    if (error) throw error;
  }
  res.json({ ok: true });
}));

router.get('/settings/buyer-info/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: infos } = await supabase
    .from('buyer_info')
    .select('*')
    .eq('user_id', req.params.userId);

  res.json({
    response: {
      results: infos ?? [],
    },
  });
}));

const BUYER_INFO_ALLOWED_FIELDS = new Set([
  'buyer_type', 'buying_reason', 'buying_experience', 'decision_speed',
  'industry_preferences', 'excluded_sectors', 'geography',
  'turnover_range', 'ebitda_range', 'ebitda_margin_min', 'asset_base',
  'valuation_range', 'deal_structure_preference', 'funding_source',
  'business_age', 'employee_headcount', 'customer_base_type',
  'contractual_recurrence', 'ip_technology', 'physical_digital',
  'involvement', 'problems',
]);

router.patch('/settings/buyer-info/:buyerInfoId', requireAuth, wrap(async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(body)) {
    if (BUYER_INFO_ALLOWED_FIELDS.has(key)) update[key] = val;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('buyer_info').update(update).eq('id', req.params.buyerInfoId);
    if (error) throw error;
  }
  res.json({ ok: true });
}));

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

router.get('/notifications/nda/:outreachId', requireAuth, wrap(async (req, res) => {
  const { data } = await supabase
    .from('langcliffe_outreach')
    .select('nda_file')
    .eq('id', req.params.outreachId)
    .single();

  const path = data?.nda_file ?? null;
  if (!path) { res.json({ nda_file_url: null }); return; }

  // Generate a signed URL (1 hour expiry) for the private file
  const { data: urlData, error } = await supabase.storage
    .from('files')
    .createSignedUrl(path, 3600);

  res.json({ nda_file_url: error ? null : urlData.signedUrl });
}));

router.get('/notifications/:userId', requireAuth, wrap(async (req, res) => {
  if (!assertOwner(req, res)) return;
  const { data: notifications } = await supabase
    .from('user_notification')
    .select('*')
    .eq('user_id', req.params.userId)
    .eq('status', 'unread')
    .order('created_at', { ascending: false });

  res.json({
    response: {
      results: notifications ?? [],
    },
  });
}));

router.patch('/notifications/:notificationId/action', requireAuth, wrap(async (req, res) => {
  const { error } = await supabase
    .from('user_notification')
    .update({ status: 'actioned' })
    .eq('id', req.params.notificationId);
  if (error) throw error;
  res.json({ ok: true });
}));

export default router;
