'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Activity, SlidersHorizontal } from 'lucide-react';
import { AlgaLogo } from '../AlgaLogo';
import styles from '../status.module.css';

type SetupConfig = {
  mode?: string;
  defaults?: {
    channel?: string;
    appHostname?: string;
    dnsMode?: string;
    dnsServers?: string;
    repoUrl?: string;
    repoBranch?: string;
  };
  network?: {
    addresses?: string[];
    resolvers?: string[];
  };
};

type FieldErrors = Partial<Record<'appHostname' | 'dnsServers' | 'repoUrl' | 'repoBranch', string>>;

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

function validateSetupForm(payload: { appHostname: string; dnsMode: string; dnsServers: string; repoUrl: string; repoBranch: string }) {
  const errors: FieldErrors = {};

  if (!payload.appHostname.trim()) {
    errors.appHostname = 'Enter the full URL users will open after setup.';
  } else {
    try {
      const parsed = new URL(payload.appHostname.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.appHostname = 'Use an http or https URL.';
      }
    } catch {
      errors.appHostname = 'Use a full URL, for example http://192.168.1.50:3000.';
    }
  }

  if (payload.dnsMode === 'custom') {
    const servers = payload.dnsServers.split(',').map((value) => value.trim()).filter(Boolean);
    if (servers.length === 0) {
      errors.dnsServers = 'Enter at least one DNS server for custom DNS.';
    } else {
      const invalid = servers.filter((server) => !isValidIpv4(server));
      if (invalid.length) errors.dnsServers = `Check these IPv4 addresses: ${invalid.join(', ')}.`;
    }
  }

  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(payload.repoUrl) && !/^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(payload.repoUrl)) {
    errors.repoUrl = 'Use a GitHub HTTPS URL or git@github.com:owner/repo.git.';
  }

  if (payload.repoBranch && !/^[A-Za-z0-9._/-]+$/.test(payload.repoBranch)) {
    errors.repoBranch = 'Use a branch name with letters, numbers, dots, slashes, underscores, or hyphens.';
  }

  return errors;
}

function SkeletonCard() {
  return (
    <article className={`${styles.card} ${styles.full}`} aria-busy="true">
      <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
      <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
    </article>
  );
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

  useEffect(() => {
    setQuery(tokenQuery());
  }, []);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      channel: String(formData.get('channel') || channel),
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

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  const resolvers = config?.network?.resolvers || [];
  const addresses = config?.network?.addresses || [];
  const disabled = busy || !config;

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}><AlgaLogo className={styles.logoSvg} /></span>
          <span className={styles.brandText}><span>Alga PSA</span><small>Setup</small></span>
        </div>
        <nav className={styles.nav} aria-label="Alga PSA setup pages">
          <a className={styles.setupLink} aria-current="page" href={withToken('/setup/', query)}><SlidersHorizontal className={styles.navIcon} aria-hidden="true" /><span>Setup</span></a>
          <a className={styles.setupLink} href={withToken('/', query)}><Activity className={styles.navIcon} aria-hidden="true" /><span>Status</span></a>
        </nav>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.commandBar}>
          <div>
            <div className={styles.eyebrow}>Guided setup</div>
            <h1>Configure your appliance</h1>
            <p className={styles.muted}>Confirm the release channel, app URL, and DNS behavior. Advanced support settings stay tucked away unless you need them.</p>
          </div>
          <span className={`${styles.statusPill} ${styles.installing}`}>{busy ? 'Starting setup' : 'Setup'}</span>
        </header>

        <section className={styles.grid}>
          {!config && !error ? <SkeletonCard /> : null}

          <article className={`${styles.card} ${styles.full}`}>
            <h2>Network detected from Ubuntu</h2>
            {!config && !error ? (
              <>
                <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
                <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
              </>
            ) : (
              <dl className={styles.kv}>
                <div><dt>Node addresses</dt><dd>{addresses.length ? addresses.join(', ') : 'No non-loopback address detected'}</dd></div>
                <div><dt>System resolvers</dt><dd>{resolvers.length ? resolvers.join(', ') : 'No resolver detected'}</dd></div>
              </dl>
            )}
          </article>

          <article className={`${styles.card} ${styles.full}`}>
            <h2>Setup details</h2>
            <form id="appliance-setup-form" className={styles.form} onSubmit={submit} noValidate>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="setup-channel">Release channel</label>
                  <select id="setup-channel" name="channel" value={channel} onChange={(event) => setChannel(event.target.value)} disabled={disabled}>
                    <option value="stable">stable (recommended)</option>
                    <option value="nightly">nightly (testing/support-directed)</option>
                  </select>
                  <span className={styles.helpText}>Stable is recommended unless support asks you to test nightly.</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-app-hostname">App URL</label>
                  <input id="setup-app-hostname" name="appHostname" value={appHostname} onChange={(event) => { setAppHostname(event.target.value); clearFieldError('appHostname'); }} placeholder="http://192.168.1.50:3000" disabled={disabled} aria-invalid={Boolean(fieldErrors.appHostname)} aria-describedby="setup-app-hostname-help setup-app-hostname-error" />
                  <span id="setup-app-hostname-help" className={styles.helpText}>Use the full URL users will enter in their browser. The default local URL works out of the box.</span>
                  {fieldErrors.appHostname ? <span id="setup-app-hostname-error" className={styles.fieldError}>{fieldErrors.appHostname}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-dns-mode">DNS mode</label>
                  <select id="setup-dns-mode" name="dnsMode" value={dnsMode} onChange={(event) => { setDnsMode(event.target.value); clearFieldError('dnsServers'); }} disabled={disabled}>
                    <option value="system">Use DHCP/system resolvers</option>
                    <option value="custom">Use custom DNS servers</option>
                  </select>
                  <span className={styles.helpText}>Keep system DNS unless this site requires specific internal resolvers.</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-dns-servers">Custom DNS servers</label>
                  <input id="setup-dns-servers" name="dnsServers" value={dnsServers} onChange={(event) => { setDnsServers(event.target.value); clearFieldError('dnsServers'); }} placeholder="8.8.8.8,8.8.4.4" disabled={disabled || dnsMode !== 'custom'} aria-invalid={Boolean(fieldErrors.dnsServers)} aria-describedby="setup-dns-servers-help setup-dns-servers-error" />
                  <span id="setup-dns-servers-help" className={styles.helpText}>Comma-separated IPv4 addresses. Required only for custom DNS.</span>
                  {fieldErrors.dnsServers ? <span id="setup-dns-servers-error" className={styles.fieldError}>{fieldErrors.dnsServers}</span> : null}
                </div>

                <details className={styles.advancedSupport}>
                  <summary className={styles.advancedSummary}>Advanced support</summary>
                  <p className={styles.helpText}>Change these only when support asks you to use a specific repository or branch.</p>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="setup-repo-url">Repo URL override</label>
                      <input id="setup-repo-url" name="repoUrl" value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); clearFieldError('repoUrl'); }} disabled={disabled} aria-invalid={Boolean(fieldErrors.repoUrl)} aria-describedby="setup-repo-url-help setup-repo-url-error" />
                      <span id="setup-repo-url-help" className={styles.helpText}>Support/testing only.</span>
                      {fieldErrors.repoUrl ? <span id="setup-repo-url-error" className={styles.fieldError}>{fieldErrors.repoUrl}</span> : null}
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="setup-repo-branch">Repo branch override</label>
                      <input id="setup-repo-branch" name="repoBranch" value={repoBranch} onChange={(event) => { setRepoBranch(event.target.value); clearFieldError('repoBranch'); }} placeholder="main" disabled={disabled} aria-invalid={Boolean(fieldErrors.repoBranch)} aria-describedby="setup-repo-branch-help setup-repo-branch-error" />
                      <span id="setup-repo-branch-help" className={styles.helpText}>Leave blank to use the selected release channel.</span>
                      {fieldErrors.repoBranch ? <span id="setup-repo-branch-error" className={styles.fieldError}>{fieldErrors.repoBranch}</span> : null}
                    </div>
                  </div>
                </details>
              </div>

              {error ? <div className={styles.alert} role="alert">{error}</div> : null}

              <div className={styles.formFooter}>
                <a className={`${styles.actionButton} ${styles.secondary}`} href={withToken('/', query)}>View status</a>
                <button id="setup-submit" className={styles.primaryButton} type="submit" disabled={busy || !config}>{busy ? 'Starting setup…' : 'Save and continue'}</button>
              </div>
            </form>
          </article>
        </section>
      </section>
    </main>
  );
}
