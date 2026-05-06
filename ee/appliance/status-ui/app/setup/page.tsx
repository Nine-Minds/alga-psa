'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
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

function tokenQuery() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function withToken(path: string, query: string) {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query.slice(1)}` : `${path}${query}`;
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
  const query = useMemo(tokenQuery, []);
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('stable');
  const [appHostname, setAppHostname] = useState('');
  const [dnsMode, setDnsMode] = useState('system');
  const [dnsServers, setDnsServers] = useState('');
  const [repoUrl, setRepoUrl] = useState('https://github.com/Nine-Minds/alga-psa.git');
  const [repoBranch, setRepoBranch] = useState('');

  useEffect(() => {
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
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withToken('/api/setup', query), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, appHostname, dnsMode, dnsServers, repoUrl, repoBranch }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save setup.');
      window.location.href = withToken('/', query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const resolvers = config?.network?.resolvers || [];
  const addresses = config?.network?.addresses || [];

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span className={styles.logo}>A</span><span>Alga PSA Appliance</span></div>
        <nav className={styles.nav} aria-label="Appliance pages">
          <a href={withToken('/setup/', query)}>Setup</a>
          <a href={withToken('/', query)}>Status</a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.eyebrow}>Guided setup</div>
        <h1>Configure your appliance</h1>
        <p>Confirm the release channel, app hostname, and DNS behavior. Network and disk selection happen in the Ubuntu Server installer before this step.</p>
      </section>

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
          <form id="appliance-setup-form" className={styles.form} onSubmit={submit}>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="setup-channel">Release channel</label>
                <select id="setup-channel" value={channel} onChange={(event) => setChannel(event.target.value)} disabled={busy || !config}>
                  <option value="stable">stable (recommended)</option>
                  <option value="nightly">nightly (testing/support-directed)</option>
                </select>
                <span className={styles.helpText}>Stable is recommended unless support asks you to test nightly.</span>
              </div>

              <div className={styles.field}>
                <label htmlFor="setup-app-hostname">App URL / hostname</label>
                <input id="setup-app-hostname" value={appHostname} onChange={(event) => setAppHostname(event.target.value)} placeholder="psa.example.com" disabled={busy || !config} />
                <span className={styles.helpText}>Use the hostname users will enter in their browser.</span>
              </div>

              <div className={styles.field}>
                <label htmlFor="setup-dns-mode">DNS mode</label>
                <select id="setup-dns-mode" value={dnsMode} onChange={(event) => setDnsMode(event.target.value)} disabled={busy || !config}>
                  <option value="system">Use DHCP/system resolvers</option>
                  <option value="custom">Use custom DNS servers</option>
                </select>
                <span className={styles.helpText}>Keep system DNS unless this site requires specific internal resolvers.</span>
              </div>

              <div className={styles.field}>
                <label htmlFor="setup-dns-servers">Custom DNS servers</label>
                <input id="setup-dns-servers" value={dnsServers} onChange={(event) => setDnsServers(event.target.value)} placeholder="8.8.8.8,8.8.4.4" disabled={busy || !config || dnsMode !== 'custom'} />
                <span className={styles.helpText}>Comma-separated IPv4 addresses. Required only for custom DNS.</span>
              </div>

              <div className={styles.field}>
                <label htmlFor="setup-repo-url">Repo URL override</label>
                <input id="setup-repo-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} disabled={busy || !config} />
                <span className={styles.helpText}>Support/testing only.</span>
              </div>

              <div className={styles.field}>
                <label htmlFor="setup-repo-branch">Repo branch override</label>
                <input id="setup-repo-branch" value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)} placeholder="main" disabled={busy || !config} />
                <span className={styles.helpText}>Leave blank to use the selected release channel.</span>
              </div>
            </div>

            {error ? <div className={styles.alert}>{error}</div> : null}

            <div className={styles.formFooter}>
              <a className={`${styles.actionButton} ${styles.secondary}`} href={withToken('/', query)}>View status</a>
              <button id="setup-submit" className={styles.primaryButton} type="submit" disabled={busy || !config}>{busy ? 'Starting setup…' : 'Save and continue'}</button>
            </div>
          </form>
        </article>
      </section>
    </main>
  );
}
