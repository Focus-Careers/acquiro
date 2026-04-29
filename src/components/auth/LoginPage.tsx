import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, ArrowRight, Mail } from 'lucide-react';
import { sendMagicLink, getUserByMagicLink } from '../../services/userService';
import { useAdvisorStore } from '../../hooks/useAdvisorStore';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkParam = searchParams.get('link');
  const { userId, setUserId, setUserName, setUserEmail, setAuthToken } = useAdvisorStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    if (userId) {
      navigate('/dashboard', { replace: true });
    }
  }, [userId, navigate]);

  useEffect(() => {
    if (!linkParam || !linkParam.trim()) return;
    setVerifying(true);
    setLinkExpired(false);
    getUserByMagicLink(linkParam)
      .then((user) => {
        setUserEmail(user.email);
        setUserId(user.user_id);
        if (user.name) setUserName(user.name);
        if (user.auth_token) setAuthToken(user.auth_token);
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        setLinkExpired(true);
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [linkParam, setUserId, setUserName, setUserEmail, navigate]);

  if (userId) {
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email.');
      return;
    }
    setLoading(true);
    try {
      await sendMagicLink(trimmed);
      setEmailSent(trimmed);
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'SEND_MAGIC_LINK_ERROR'
          ? 'No account with that email exists.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loginLayout = (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg-primary relative px-4 py-6 md:p-10">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(600px 600px at 50% 35%, rgba(198, 255, 74, 0.15) 0%, transparent 70%)',
        }}
      />
      <main className="relative z-10 w-full max-w-[420px] flex flex-col items-center min-w-0">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="w-full flex flex-col items-center"
        >
          <Link
            to="/"
            className="font-display font-bold text-[1.6rem] text-text-primary hover:opacity-90 transition-opacity mb-8 inline-flex items-center"
            style={{ fontFamily: 'Petrona, Georgia, serif', fontWeight: 700 }}
          >
            <span className="relative inline-flex items-baseline">
              acquiro<span className="text-accent">.</span>
              <span className="absolute right-[-1em] bottom-[2.2em] font-mono text-[10px] sm:text-xs uppercase tracking-wider text-[var(--text-tertiary)]">BETA</span>
            </span>
          </Link>
          <h1
            className="font-display font-bold text-text-primary text-center w-full mb-2 text-2xl md:text-[1.8rem]"
            style={{ fontFamily: 'Petrona, Georgia, serif', fontWeight: 700 }}
          >
            Welcome back
          </h1>
          <p
            className="text-text-secondary text-center w-full mb-8 font-sans"
            style={{ fontSize: '0.95rem', fontFamily: 'Afacad, sans-serif', fontWeight: 300 }}
          >
            Enter your email to sign in via magic link
          </p>

          <form onSubmit={handleSubmit} className="w-full flex flex-col">
            <label
              htmlFor="login-email"
              className="block text-text-secondary font-medium mb-1.5 font-sans"
              style={{ fontSize: '0.82rem' }}
            >
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@example.com"
              className="w-full rounded-[10px] border font-sans text-[0.95rem] text-text-primary placeholder-text-muted disabled:opacity-60 transition-[border-color,background-color,box-shadow] focus:outline-none mb-5"
              style={{
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderColor: 'rgba(255, 255, 255, 0.06)',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(198, 255, 74, 0.4)';
                e.target.style.background = 'rgba(198, 255, 74, 0.03)';
                e.target.style.boxShadow = '0 0 0 3px rgba(198, 255, 74, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                e.target.style.background = 'rgba(255, 255, 255, 0.03)';
                e.target.style.boxShadow = 'none';
              }}
            />

            {error && (
              <p className="text-[0.85rem] text-center mb-4" style={{ color: '#f43f5e' }} role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] rounded-pill font-sans font-semibold text-[0.95rem] flex items-center justify-center gap-2 transition-all disabled:opacity-70 hover:bg-accent-light hover:-translate-y-px hover:shadow-accent-sm focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary"
              style={{
                padding: '14px 24px',
                background: '#c6ff4a',
                color: '#0A0A0C',
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-[18px] h-[18px] animate-spin" strokeWidth={2.5} />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <span>Send Magic Link</span>
                  <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center font-sans" style={{ fontSize: '0.88rem' }}>
            <span className="text-text-muted">New here? </span>
            <Link
              to="/builder"
              className="text-accent font-medium hover:text-accent-light transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary rounded"
            >
              Build your AI advisor to get started
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );

  if (verifying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg-primary p-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(600px 600px at 50% 35%, rgba(198, 255, 74, 0.15) 0%, transparent 70%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-accent" />
          <p className="text-text-secondary font-sans text-[0.95rem]">Verifying your link...</p>
        </div>
      </div>
    );
  }

  if (linkExpired) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg-primary p-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(600px 600px at 50% 35%, rgba(198, 255, 74, 0.15) 0%, transparent 70%)',
          }}
        />
        <div className="relative z-10 max-w-md text-center flex flex-col items-center gap-6">
          <p className="text-text-primary font-sans text-[0.95rem]">
            The link has expired. Please try logging in again.
          </p>
          <Link
            to="/login"
            className="rounded-pill font-sans font-semibold text-[0.95rem] px-6 py-3 bg-accent text-bg-primary hover:bg-accent-light transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg-primary p-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(600px 600px at 50% 35%, rgba(198, 255, 74, 0.15) 0%, transparent 70%)',
          }}
        />
        <div className="relative z-10 max-w-md text-center flex flex-col items-center gap-6">
          <Mail className="w-14 h-14 text-accent" />
          <h2
            className="font-display font-bold text-text-primary"
            style={{ fontSize: '1.5rem', fontFamily: 'Petrona, Georgia, serif', fontWeight: 700 }}
          >
            Check your inbox
          </h2>
          <p className="text-text-secondary font-sans text-[0.95rem] leading-relaxed">
            We’ve sent a login link to <strong className="text-text-primary">{emailSent}</strong>. The link is
            active for 15 minutes.
          </p>
        </div>
      </div>
    );
  }

  return loginLayout;
}
