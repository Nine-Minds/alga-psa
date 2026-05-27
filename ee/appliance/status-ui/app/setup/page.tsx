'use client';

import { FormEvent, useEffect, useState } from 'react';
import styles from '../status.module.css';

type SetupConfig = {
  defaults?: {
    channel?: string;
    appHostname?: string;
    dnsMode?: string;
    dnsServers?: string;
    repoUrl?: string;
    repoBranch?: string;
  };
  network?: { addresses?: string[]; resolvers?: string[] };
};

type FieldErrors = Partial<Record<'tenantName' | 'adminFirstName' | 'adminLastName' | 'adminEmail' | 'adminPassword' | 'adminPasswordConfirm' | 'appHostname' | 'dnsServers' | 'repoUrl' | 'repoBranch', string>>;

function tokenQuery() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function withToken(path: string, query: string) {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query.slice(1)}` : `${path}${query}`;
}

function isValidIpv4(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function passwordValidationError(value: string) {
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Include a special character.';
  return null;
}

function validateSetupForm(payload: { tenantName: string; adminFirstName: string; adminLastName: string; adminEmail: string; adminPassword: string; adminPasswordConfirm: string; appHostname: string; dnsMode: string; dnsServers: string; repoUrl: string; repoBranch: string }) {
  const errors: FieldErrors = {};
  if (!payload.tenantName.trim()) errors.tenantName = 'Enter the company name for the initial tenant.';
  if (!payload.adminFirstName.trim()) errors.adminFirstName = 'Enter the admin first name.';
  if (!payload.adminLastName.trim()) errors.adminLastName = 'Enter the admin last name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.adminEmail.trim())) errors.adminEmail = 'Enter a valid admin email address.';
  const passwordError = passwordValidationError(payload.adminPassword);
  if (passwordError) errors.adminPassword = passwordError;
  if (payload.adminPassword !== payload.adminPasswordConfirm) errors.adminPasswordConfirm = 'Passwords do not match.';

  if (!payload.appHostname.trim()) {
    errors.appHostname = 'Enter the full URL users will open after setup.';
  } else {
    try {
      const parsed = new URL(payload.appHostname.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) errors.appHostname = 'Use an http or https URL.';
    } catch {
      errors.appHostname = 'Use a full URL, for example http://192.168.1.50:3000.';
    }
  }

  if (payload.dnsMode === 'custom') {
    const servers = payload.dnsServers.split(',').map((value) => value.trim()).filter(Boolean);
    if (servers.length === 0) errors.dnsServers = 'Enter at least one DNS server for custom DNS.';
    else {
      const invalid = servers.filter((server) => !isValidIpv4(server));
      if (invalid.length) errors.dnsServers = `Check these IPv4 addresses: ${invalid.join(', ')}.`;
    }
  }

  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(payload.repoUrl) && !/^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(payload.repoUrl)) {
    errors.repoUrl = 'Use a GitHub HTTPS URL or git@github.com:owner/repo.git.';
  }
  if (payload.repoBranch && !/^[A-Za-z0-9._/-]+$/.test(payload.repoBranch)) errors.repoBranch = 'Use a branch name with letters, numbers, dots, slashes, underscores, or hyphens.';
  return errors;
}

export default function SetupPage() {
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('stable');
  const [appHostname, setAppHostname] = useState('');
  const [dnsMode, setDnsMode] = useState('system');
  const [dnsServers, setDnsServers] = useState('');
  const [repoUrl, setRepoUrl] = useState('https://github.com/Nine-Minds/alga-psa.git');
  const [repoBranch, setRepoBranch] = useState('');

  useEffect(() => { setQuery(tokenQuery()); }, []);
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    async function loadConfig() {
      try {
        const response = await fetch(withToken('/api/setup/config', query), { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 401 ? 'Unauthorized: check the setup token.' : 'Unable to load setup defaults.');
        const data = (await response.json()) as SetupConfig;
        if (cancelled) return;
        setConfig(data);
        setChannel(data.defaults?.channel || 'stable');
        setAppHostname(data.defaults?.appHostname || '');
        setDnsMode(data.defaults?.dnsMode || 'system');
        setDnsServers(data.defaults?.dnsServers || '');
        setRepoUrl(data.defaults?.repoUrl || 'https://github.com/Nine-Minds/alga-psa.git');
        setRepoBranch(data.defaults?.repoBranch || '');
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, [query]);

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      channel: String(formData.get('channel') || channel),
      tenantName: String(formData.get('tenantName') || ''),
      adminFirstName: String(formData.get('adminFirstName') || ''),
      adminLastName: String(formData.get('adminLastName') || ''),
      adminEmail: String(formData.get('adminEmail') || ''),
      adminPassword: String(formData.get('adminPassword') || ''),
      adminPasswordConfirm: String(formData.get('adminPasswordConfirm') || ''),
      appHostname: String(formData.get('appHostname') || ''),
      dnsMode: String(formData.get('dnsMode') || dnsMode),
      dnsServers: String(formData.get('dnsServers') || ''),
      repoUrl: String(formData.get('repoUrl') || repoUrl),
      repoBranch: String(formData.get('repoBranch') || ''),
    };
    const validation = validateSetupForm(payload);
    setFieldErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withToken('/api/setup', query), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save setup.');
      window.location.href = withToken('/', query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const disabled = busy || !config;
  const fieldStyle = { display: 'grid', gap: 6, marginBottom: 14 };
  const inputStyle = { padding: '9px 10px', borderRadius: 10, border: '1px solid rgb(var(--color-border-200))' };
  const errorStyle = { color: 'rgb(var(--color-error))', fontSize: 13 };

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Guided setup</div>
        <h1>Configure your appliance</h1>
        <p>Enter the first company and admin account. You will use this admin email and password to sign in after setup completes.</p>
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.full}`}>
          <h2>Detected network</h2>
          <dl className={styles.kv}>
            <div><dt>Node addresses</dt><dd>{config?.network?.addresses?.join(', ') || 'Loading…'}</dd></div>
            <div><dt>System resolvers</dt><dd>{config?.network?.resolvers?.join(', ') || 'Loading…'}</dd></div>
          </dl>
        </article>

        <article className={`${styles.card} ${styles.full}`}>
          <h2>Setup details</h2>
          <form onSubmit={submit} noValidate>
            <div style={fieldStyle}><label>Release channel<select name="channel" value={channel} onChange={(event) => setChannel(event.target.value)} disabled={disabled} style={inputStyle}><option value="stable">stable</option><option value="nightly">nightly</option></select></label></div>
            <div style={fieldStyle}><label>Company name<input name="tenantName" disabled={disabled} required style={inputStyle} onChange={() => clearFieldError('tenantName')} /></label>{fieldErrors.tenantName ? <span style={errorStyle}>{fieldErrors.tenantName}</span> : null}</div>
            <div style={fieldStyle}><label>Admin first name<input name="adminFirstName" disabled={disabled} required style={inputStyle} onChange={() => clearFieldError('adminFirstName')} /></label>{fieldErrors.adminFirstName ? <span style={errorStyle}>{fieldErrors.adminFirstName}</span> : null}</div>
            <div style={fieldStyle}><label>Admin last name<input name="adminLastName" disabled={disabled} required style={inputStyle} onChange={() => clearFieldError('adminLastName')} /></label>{fieldErrors.adminLastName ? <span style={errorStyle}>{fieldErrors.adminLastName}</span> : null}</div>
            <div style={fieldStyle}><label>Admin email<input name="adminEmail" type="email" disabled={disabled} required style={inputStyle} onChange={() => clearFieldError('adminEmail')} /></label>{fieldErrors.adminEmail ? <span style={errorStyle}>{fieldErrors.adminEmail}</span> : null}</div>
            <div style={fieldStyle}><label>Admin password<input name="adminPassword" type="password" autoComplete="new-password" disabled={disabled} required style={inputStyle} onChange={() => { clearFieldError('adminPassword'); clearFieldError('adminPasswordConfirm'); }} /></label><span className={styles.muted}>At least 8 characters with uppercase, lowercase, number, and special character.</span>{fieldErrors.adminPassword ? <span style={errorStyle}>{fieldErrors.adminPassword}</span> : null}</div>
            <div style={fieldStyle}><label>Confirm admin password<input name="adminPasswordConfirm" type="password" autoComplete="new-password" disabled={disabled} required style={inputStyle} onChange={() => clearFieldError('adminPasswordConfirm')} /></label>{fieldErrors.adminPasswordConfirm ? <span style={errorStyle}>{fieldErrors.adminPasswordConfirm}</span> : null}</div>
            <div style={fieldStyle}><label>App URL<input name="appHostname" value={appHostname} onChange={(event) => { setAppHostname(event.target.value); clearFieldError('appHostname'); }} disabled={disabled} required style={inputStyle} /></label>{fieldErrors.appHostname ? <span style={errorStyle}>{fieldErrors.appHostname}</span> : null}</div>
            <div style={fieldStyle}><label>DNS mode<select name="dnsMode" value={dnsMode} onChange={(event) => { setDnsMode(event.target.value); clearFieldError('dnsServers'); }} disabled={disabled} style={inputStyle}><option value="system">Use DHCP/system resolvers</option><option value="custom">Use custom DNS servers</option></select></label></div>
            <div style={fieldStyle}><label>Custom DNS servers<input name="dnsServers" value={dnsServers} onChange={(event) => { setDnsServers(event.target.value); clearFieldError('dnsServers'); }} disabled={disabled || dnsMode !== 'custom'} style={inputStyle} placeholder="8.8.8.8,8.8.4.4" /></label>{fieldErrors.dnsServers ? <span style={errorStyle}>{fieldErrors.dnsServers}</span> : null}</div>
            <details>
              <summary>Advanced support</summary>
              <div style={fieldStyle}><label>Repo URL override<input name="repoUrl" value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); clearFieldError('repoUrl'); }} disabled={disabled} style={inputStyle} /></label>{fieldErrors.repoUrl ? <span style={errorStyle}>{fieldErrors.repoUrl}</span> : null}</div>
              <div style={fieldStyle}><label>Repo branch override<input name="repoBranch" value={repoBranch} onChange={(event) => { setRepoBranch(event.target.value); clearFieldError('repoBranch'); }} disabled={disabled} style={inputStyle} /></label>{fieldErrors.repoBranch ? <span style={errorStyle}>{fieldErrors.repoBranch}</span> : null}</div>
            </details>
            {error ? <p style={errorStyle} role="alert">{error}</p> : null}
            <button className={styles.actionButton} type="submit" disabled={busy || !config}>{busy ? 'Starting setup…' : 'Save and continue'}</button>
          </form>
        </article>
      </section>
    </main>
  );
}
