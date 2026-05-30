'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { AlgaLogo } from '../AlgaLogo';
import styles from './auth.module.css';
import { TokenInput } from './TokenInput';

type Phase = 'loading' | 'error' | 'needs-token' | 'set-password' | 'needs-password' | 'authenticated';

function passwordValidationError(value: string): string | null {
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Include a special character.';
  return null;
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}><AlgaLogo className={styles.logoSvg} /></span>
          <span className={styles.brandText}><strong>Alga PSA</strong><small>Appliance setup</small></span>
        </div>
        <div className={styles.heading}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [token, setToken] = useState('');
  const [tokenComplete, setTokenComplete] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadState() {
    try {
      const response = await fetch('/api/auth/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to reach the appliance.');
      const data = await response.json();
      setPhase(data.phase === 'authenticated' ? 'authenticated' : data.phase === 'needs-password' ? 'needs-password' : 'needs-token');
    } catch {
      setPhase('error');
    }
  }

  useEffect(() => { loadState(); }, []);

  async function postJson(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function submitToken(event?: FormEvent) {
    event?.preventDefault();
    if (!tokenComplete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await postJson('/api/auth/redeem-token', { token });
      if (!response.ok) throw new Error(data.error || 'Incorrect setup token.');
      setPhase('set-password');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitSetPassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const policyError = passwordValidationError(password);
    if (policyError) { setError(policyError); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await postJson('/api/auth/set-password', { token, password });
      if (!response.ok) throw new Error(data.error || 'Unable to set the password.');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await postJson('/api/auth/login', { password });
      if (!response.ok) throw new Error(data.error || 'Incorrect password.');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (phase === 'authenticated') return <>{children}</>;

  if (phase === 'loading') {
    return <Shell title="Loading" subtitle="Checking appliance status…"><p className={styles.loading}>One moment…</p></Shell>;
  }

  if (phase === 'error') {
    return (
      <Shell title="Can’t reach the appliance" subtitle="The setup service did not respond.">
        <button type="button" className={styles.button} onClick={() => { setPhase('loading'); loadState(); }}>Retry</button>
      </Shell>
    );
  }

  if (phase === 'needs-token') {
    return (
      <Shell title="Enter your setup token" subtitle="Type the one-time token printed on the appliance console. You only enter this once — then you’ll choose a password.">
        <form className={styles.form} onSubmit={submitToken}>
          <TokenInput disabled={busy} onChange={(value, complete) => { setToken(value); setTokenComplete(complete); }} onSubmit={() => submitToken()} />
          {error ? <div className={styles.alert} role="alert">{error}</div> : null}
          <button type="submit" className={styles.button} disabled={!tokenComplete || busy}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      </Shell>
    );
  }

  if (phase === 'set-password') {
    return (
      <Shell title="Choose a management password" subtitle="You’ll use this password to sign in to the appliance setup and status pages from now on.">
        <form className={styles.form} onSubmit={submitSetPassword}>
          <div className={styles.field}>
            <label htmlFor="auth-new-password">New password</label>
            <input id="auth-new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} disabled={busy} />
            <span className={styles.helpText}>At least 8 characters with uppercase, lowercase, number, and special character.</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="auth-confirm-password">Confirm password</label>
            <input id="auth-confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(null); }} disabled={busy} />
          </div>
          {error ? <div className={styles.alert} role="alert">{error}</div> : null}
          <button type="submit" className={styles.button} disabled={busy}>{busy ? 'Saving…' : 'Set password and continue'}</button>
        </form>
      </Shell>
    );
  }

  // needs-password
  return (
    <Shell title="Sign in" subtitle="Enter the management password you chose during setup.">
      <form className={styles.form} onSubmit={submitLogin}>
        <div className={styles.field}>
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} disabled={busy} autoFocus />
        </div>
        {error ? <div className={styles.alert} role="alert">{error}</div> : null}
        <button type="submit" className={styles.button} disabled={busy || password.length === 0}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}
