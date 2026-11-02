import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { useAdvisorStore } from '../../hooks/useAdvisorStore';
import { getMyAgent, getMyBuyerInfo, updateBuyerInfo, getUserProfile, updateUserProfile } from '../../services/settingsService';
import { API_URL } from '../../utils/apiUrl';
import { getAuthHeaders } from '../../utils/authHeaders';
import langcliffeLogo from '../../assets/langcliffe-logo.png';
import dealsuitelogo from '../../assets/dealsuite-logo.png';

function sanitiseAgentName(name: string): string {
  return (name ?? 'agent')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || 'agent';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function LangcliffeSetup({ userId, connected, onMarkConnected, markingConnected }: {
  userId: string;
  connected: boolean;
  onMarkConnected: () => void;
  markingConnected: boolean;
}) {
  const [agentEmail, setAgentEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyerInfoId, setBuyerInfoId] = useState<string | null>(null);
  const [overview, setOverview] = useState('');
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [overviewSaved, setOverviewSaved] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactEmailSaving, setContactEmailSaving] = useState(false);
  const [contactEmailSaved, setContactEmailSaved] = useState(false);

  useEffect(() => {
    Promise.all([getMyAgent(userId), getMyBuyerInfo(userId)])
      .then(([agent, buyerInfo]) => {
        if (agent) setAgentEmail(`${sanitiseAgentName(agent.name ?? 'agent')}@acquiro-agent.com`);
        if (buyerInfo) {
          setBuyerInfoId(buyerInfo.id);
          setOverview(buyerInfo.company_overview ?? '');
          setContactEmail(buyerInfo.langcliffe_contact_email ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSaveContactEmail = async () => {
    if (!buyerInfoId) return;
    setContactEmailSaving(true);
    try {
      await updateBuyerInfo(buyerInfoId, { langcliffe_contact_email: contactEmail.trim().toLowerCase() });
      setContactEmailSaved(true);
      setTimeout(() => setContactEmailSaved(false), 2000);
    } catch {
      // fail silently
    } finally {
      setContactEmailSaving(false);
    }
  };

  const handleGenerateFromWebsite = async () => {
    if (!websiteUrl.trim()) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch(`${API_URL}/api/integrations/summarise-website`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ url: websiteUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to generate summary');
      setOverview(json.summary);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveOverview = async () => {
    if (!buyerInfoId) return;
    setOverviewSaving(true);
    try {
      await updateBuyerInfo(buyerInfoId, { company_overview: overview });
      setOverviewSaved(true);
      setTimeout(() => setOverviewSaved(false), 2000);
    } catch {
      // fail silently
    } finally {
      setOverviewSaving(false);
    }
  };

  return (
    <section className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6">
      <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">Langcliffe International — Setup</h2>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
        Langcliffe International sends a daily email listing businesses available for acquisition across the UK. Once set up, your advisor will automatically receive this list, score each opportunity against your criteria, and reach out to Langcliffe on your behalf, so you never miss a relevant deal.
      </p>

      <ol className="space-y-6 text-base text-[var(--text-secondary)]">

        {/* Step 1 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">1</span>
          <div>
            <p className="text-[var(--text-primary)] font-medium">Sign up to the Langcliffe daily list</p>
            <p className="mt-1">Register to receive Langcliffe International's daily deal teasers at their website.</p>
            <a
              href="https://www.langcliffeinternational.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-accent hover:underline text-sm font-medium"
            >
              langcliffeinternational.com <ExternalLink size={12} />
            </a>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">2</span>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-[var(--text-primary)] font-medium">Enter your Langcliffe contact's email</p>
              <p className="mt-1">This is the email address Langcliffe use to send you the daily list and to reply to your advisor's outreach. You'll find it in any email you've received from them.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@langcliffeinternational.com"
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-0"
              />
              <button
                type="button"
                onClick={handleSaveContactEmail}
                disabled={contactEmailSaving || !buyerInfoId || !contactEmail.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                {contactEmailSaving ? <Loader2 size={13} className="animate-spin" /> : contactEmailSaved ? <Check size={13} /> : null}
                {contactEmailSaving ? 'Saving…' : contactEmailSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        </li>

        {/* Step 3 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">3</span>
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Your advisor's forwarding address</p>
            <p className="mt-1">This is the email address your forwarding rule will send to. Copy it before moving to the next step.</p>
            <div className="mt-3">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : agentEmail ? (
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-1.5 rounded-lg break-all">
                    {agentEmail}
                  </code>
                  <CopyButton text={agentEmail} />
                </div>
              ) : (
                <p className="text-sm text-[var(--text-tertiary)] italic">Agent email not found. Check your Settings.</p>
              )}
            </div>
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">4</span>
          <div>
            <p className="text-[var(--text-primary)] font-medium">Set up email forwarding</p>
            <p className="mt-1">
              In your email client, create a forwarding rule so that any email from{' '}
              <span className="font-mono text-[var(--text-primary)] text-xs bg-[var(--bg-secondary)] px-1 py-0.5 rounded">@langcliffeinternational.com</span>{' '}
              is automatically forwarded to the address above.
            </p>
            <p className="mt-2 text-sm text-[var(--text-tertiary)]">
              In Gmail: Settings, then See all settings, then Forwarding and POP/IMAP, then Add a forwarding address, then create a filter matching the sender domain.
            </p>
          </div>
        </li>

        {/* Step 5 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">5</span>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-[var(--text-primary)] font-medium">Add your company overview</p>
              <p className="mt-1">Your advisor uses this to introduce your company when reaching out to brokers. Paste your website URL to generate a summary automatically, or write one yourself.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-0"
              />
              <button
                type="button"
                onClick={handleGenerateFromWebsite}
                disabled={generating || !websiteUrl.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {generateError && <p className="text-sm text-red-400">{generateError}</p>}
            <textarea
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              rows={4}
              placeholder="Describe your company and acquisition focus…"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
            <button
              type="button"
              onClick={handleSaveOverview}
              disabled={overviewSaving || !buyerInfoId}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {overviewSaving ? <Loader2 size={13} className="animate-spin" /> : overviewSaved ? <Check size={13} /> : null}
              {overviewSaving ? 'Saving…' : overviewSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </li>

        {/* Step 6 */}
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center mt-0.5">6</span>
          <div>
            <p className="text-[var(--text-primary)] font-medium">You're done</p>
            <p className="mt-1">
              Once forwarding is active, your advisor will process each daily list automatically. If anything matches your criteria, they will reach out to Langcliffe and gather as much information as possible to make sure it is a strong fit before bringing it to your attention. Occasionally, Langcliffe may request an NDA before sharing further details. Your advisor will handle this too and notify you via email and on your dashboard if your signature is needed.
            </p>
          </div>
        </li>

      </ol>

      {/* Connection verification */}
      <div className="mt-6 pt-6 border-t border-[var(--border)]">
        {connected ? (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <Check size={15} />
            <span className="font-medium">Langcliffe is connected</span>
            <span className="text-[var(--text-tertiary)]">— your advisor is actively processing the daily list.</span>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">Confirm your setup is complete</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Once you've forwarded your first Langcliffe email, click below to mark this integration as connected.</p>
            </div>
            <button
              type="button"
              onClick={onMarkConnected}
              disabled={markingConnected}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {markingConnected ? <Loader2 size={13} className="animate-spin" /> : null}
              {markingConnected ? 'Saving…' : 'Mark as connected'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function DealsuiteDetail() {
  return (
    <section className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white rounded-lg px-2.5 py-1.5">
          <img src={dealsuitelogo} alt="Dealsuite" className="h-6 w-auto" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Dealsuite</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border)] uppercase tracking-wider">
          Coming soon
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        Dealsuite is a leading M&amp;A deal flow platform connecting acquirers with business brokers across Europe. Once this integration is available, your advisor will be able to automatically browse and engage with deal flow from Dealsuite's authenticated platform, significantly expanding the range of opportunities they can pursue on your behalf.
      </p>
      <p className="text-sm text-[var(--text-tertiary)] mt-4">
        We'll notify you when this integration is ready to set up.
      </p>
    </section>
  );
}

type Integration = 'langcliffe' | 'dealsuite';

export function IntegrationsPage() {
  const { userId } = useAdvisorStore();
  const [selected, setSelected] = useState<Integration>('langcliffe');
  const [langcliffeConnected, setLangcliffeConnected] = useState(false);
  const [userProfileId, setUserProfileId] = useState<string | null>(null);
  const [markingConnected, setMarkingConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getUserProfile(userId).then((profile) => {
      setUserProfileId(profile.id);
      setLangcliffeConnected(profile.langcliffe_connected ?? false);
    }).catch(() => {});
  }, [userId]);

  const handleMarkConnected = async () => {
    if (!userProfileId) return;
    setMarkingConnected(true);
    try {
      await updateUserProfile(userProfileId, { langcliffe_connected: true });
      setLangcliffeConnected(true);
    } catch {
      // fail silently
    } finally {
      setMarkingConnected(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      <header className="w-full px-4 sm:px-6 py-4 flex items-center justify-between border-b border-[var(--border)]">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={20} />
          <span>Back to Dashboard</span>
        </Link>
        <h1 className="font-display font-bold text-xl text-[var(--text-primary)]">Integrations</h1>
        <div className="w-[120px]" aria-hidden />
      </header>

      <main className="flex-1 p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-6">
        {!userId ? (
          <p className="text-sm text-[var(--text-secondary)]">Please log in to manage integrations.</p>
        ) : (
          <>
            {/* Integration tiles */}
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSelected('langcliffe')}
                className={`rounded-xl border p-4 flex flex-col gap-3 text-left transition-colors ${
                  selected === 'langcliffe'
                    ? 'bg-[var(--bg-card)] border-accent'
                    : 'bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--text-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="bg-white rounded-lg px-2.5 py-1.5">
                    <img src={langcliffeLogo} alt="Langcliffe International" className="h-6 w-auto" />
                  </div>
                  {langcliffeConnected ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 uppercase tracking-wider">
                      Connected
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border)] uppercase tracking-wider">
                      Not connected
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Langcliffe International</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Daily UK deal teasers, scored and actioned by your advisor.</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelected('dealsuite')}
                className={`rounded-xl border p-4 flex flex-col gap-3 text-left transition-colors ${
                  selected === 'dealsuite'
                    ? 'bg-[var(--bg-card)] border-accent'
                    : 'bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--text-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="bg-white rounded-lg px-2.5 py-1.5">
                    <img src={dealsuitelogo} alt="Dealsuite" className="h-6 w-auto" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border)] uppercase tracking-wider">
                    Coming soon
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Dealsuite</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">M&amp;A deal flow platform — more opportunities for your advisor to pursue.</p>
                </div>
              </button>
            </div>

            {/* Detail panel */}
            {selected === 'langcliffe' && <LangcliffeSetup userId={userId} connected={langcliffeConnected} onMarkConnected={handleMarkConnected} markingConnected={markingConnected} />}
            {selected === 'dealsuite' && <DealsuiteDetail />}
          </>
        )}
      </main>
    </div>
  );
}
