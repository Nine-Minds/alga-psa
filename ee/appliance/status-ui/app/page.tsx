'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './status.module.css';

type Blocker = {
  severity?: 'critical' | 'background' | string;
  component?: string;
  layer?: string;
  reason?: string;
  nextAction?: string;
  loginBlocking?: boolean;
};

type StatusResponse = {
  status?: string;
  timestamp?: string;
  rollup?: { state?: string; message?: string; nextAction?: string } | null;
  currentPhase?: string;
  urls?: { statusUrl?: string | null; loginUrl?: string | null };
  activeOperations?: Array<{
    component?: string;
    image?: string | null;
    message?: string;
    estimatedSizeHuman?: string | null;
    elapsedSeconds?: number | null;
    progressAvailable?: boolean;
    progressPercent?: number | null;
  }>;
  tiers?: Record<string, { ready?: boolean; status?: string }>;
  topBlockers?: Blocker[];
  bootstrap?: {
    job?: { name?: string | null; state?: string; failed?: boolean; completed?: boolean };
    logs?: { available?: boolean; pod?: string | null; container?: string | null; tail?: string[]; detectedErrors?: string[] };
  };
  recentEvents?: Array<{ type?: string; reason?: string; namespace?: string; involvedObject?: string; message?: string }>;
  release?: {
    selectedReleaseVersion?: string | null;
    appVersion?: string | null;
    channel?: string | null;
    selectedChannel?: string | null;
    gitRevision?: string | null;
  };
  installState?: { status?: string; phase?: string; lastAction?: string; updatedAt?: string };
  diagnostics?: Array<{ name?: string; ok?: boolean; status?: number; command?: string; stdout?: string; stderr?: string }>;
};

function formatSeconds(value?: number | null) {
  if (value == null) return 'unknown';
  if (value < 60) return `${value}s`;
  return `${Math.floor(value / 60)}m ${value % 60}s`;
}

function badgeClass(value?: string) {
  const normalized = value || 'unknown';
  if (['fully_healthy', 'ready_to_log_in', 'ready_with_background_issues', 'healthy', 'Running', 'Succeeded', 'ready'].includes(normalized)) return styles.ready;
  if (['installing', 'progressing', 'unknown', 'Pending', 'ContainerCreating', 'PodInitializing', 'degraded', 'setup-queued'].includes(normalized)) return styles.installing;
  if (['warning', 'background'].includes(normalized)) return styles.warning;
  return styles.failed;
}

function tokenQuery() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function withToken(path: string, query: string) {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query.slice(1)}` : `${path}${query}`;
}

function SkeletonCard({ full = false }: { full?: boolean }) {
  return (
    <article className={`${styles.card} ${full ? styles.full : ''}`} aria-busy="true">
      <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
      <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
    </article>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'diagnostics'>('overview');
  const query = useMemo(tokenQuery, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/status${query}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 401 ? 'Unauthorized: check the setup token.' : 'Status API unavailable.');
        const data = (await response.json()) as StatusResponse;
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  const state = status?.rollup?.state || status?.status || status?.installState?.status || 'loading';
  const operations = status?.activeOperations || [];
  const logs = status?.bootstrap?.logs;
  const detectedError = logs?.detectedErrors?.at(-1);

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
        <div className={styles.eyebrow}>Install status</div>
        <h1>Bringing your appliance online</h1>
        <p>{error || status?.rollup?.message || status?.installState?.lastAction || 'Loading live install status…'}</p>
      </section>

      <nav className={styles.tabs} aria-label="Appliance status tabs">
        <button id="status-tab-overview" className={activeTab === 'overview' ? styles.activeTab : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button id="status-tab-diagnostics" className={activeTab === 'diagnostics' ? styles.activeTab : ''} onClick={() => setActiveTab('diagnostics')}>Diagnostics</button>
      </nav>

      {activeTab === 'overview' ? (
        <section className={styles.grid}>
          {!status && !error ? <><SkeletonCard /><SkeletonCard /><SkeletonCard full /></> : null}

          {status ? (
            <>
              <article className={`${styles.card} ${styles.overview}`}>
                <h2>Overview</h2>
                <dl className={styles.kv}>
                  <div><dt>Install state</dt><dd><span className={`${styles.badge} ${badgeClass(state)}`}>{state}</span></dd></div>
                  <div><dt>Current phase</dt><dd>{status.currentPhase || status.installState?.phase || state}</dd></div>
                  <div><dt>Last action</dt><dd>{status.installState?.lastAction || status.rollup?.nextAction || '-'}</dd></div>
                  <div><dt>Login URL</dt><dd>{status.urls?.loginUrl || 'Not available yet'}</dd></div>
                </dl>
              </article>

              <article className={`${styles.card} ${styles.operation}`}>
                <h2>Current operation</h2>
                {operations.length === 0 ? <p className={styles.muted}>No active image pull or long-running operation detected.</p> : operations.map((op, index) => (
                  <div className={styles.operationBox} key={`${op.component}-${index}`}>
                    <strong>{op.component || 'component'}</strong>
                    <p>{op.message}</p>
                    <p><code>{op.image || 'unknown image'}</code></p>
                    <p className={styles.muted}>Estimated size: {op.estimatedSizeHuman || 'unknown'} · elapsed {formatSeconds(op.elapsedSeconds)}</p>
                    <p className={styles.muted}>Pull progress: {op.progressAvailable ? `${op.progressPercent}%` : 'not available from Kubernetes'}</p>
                  </div>
                ))}
              </article>

              <article className={`${styles.card} ${styles.full}`}>
                <h2>Readiness tiers</h2>
                <div className={styles.tiers}>
                  {Object.entries(status.tiers || {}).length === 0 ? <p className={styles.muted}>Readiness data is still loading.</p> : null}
                  {Object.entries(status.tiers || {}).map(([name, tier]) => (
                    <div className={styles.tier} key={name}>
                      <strong>{name}</strong>
                      <span className={`${styles.badge} ${badgeClass(tier.status)}`}>{tier.ready ? 'ready' : 'not ready'}</span>
                      <span className={styles.muted}>{tier.status}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className={styles.card}>
                <h2>Blockers</h2>
                {(status.topBlockers || []).length === 0 ? <p className={styles.muted}>No action-required blockers detected.</p> : status.topBlockers?.map((blocker, index) => (
                  <div className={`${styles.blocker} ${blocker.loginBlocking === false ? styles.backgroundBlocker : ''}`} key={`${blocker.component}-${index}`}>
                    <strong>{blocker.component || blocker.layer}</strong>
                    <p>{blocker.reason}</p>
                    <p className={styles.muted}>{blocker.nextAction}</p>
                    {blocker.loginBlocking === false ? <p className={styles.muted}>background / non-login-blocking</p> : null}
                  </div>
                ))}
              </article>

              <article className={styles.card}>
                <h2>Bootstrap log</h2>
                {logs?.available ? (
                  <>
                    <p className={styles.muted}>{logs.pod} / {logs.container}</p>
                    {detectedError ? <div className={styles.blocker}><strong>Detected error</strong><p>{detectedError}</p></div> : null}
                    <pre className={styles.log}>{(logs.tail || []).join('\n')}</pre>
                  </>
                ) : <p className={styles.muted}>{status.bootstrap?.job?.name ? `No log excerpt available for ${status.bootstrap.job.name}.` : 'No bootstrap job log available yet.'}</p>}
              </article>

              <article className={`${styles.card} ${styles.full}`}>
                <h2>Recent events</h2>
                <div className={styles.events}>
                  {(status.recentEvents || []).length === 0 ? <p className={styles.muted}>No recent Kubernetes events loaded yet.</p> : null}
                  {(status.recentEvents || []).slice(-8).reverse().map((event, index) => (
                    <div className={styles.event} key={`${event.reason}-${index}`}>
                      <strong>{event.type} {event.reason}</strong>
                      <span>{event.namespace} {event.involvedObject}</span>
                      <p>{event.message}</p>
                    </div>
                  ))}
                </div>
              </article>
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'diagnostics' ? (
        <section className={styles.grid}>
          {!status && !error ? <SkeletonCard full /> : null}
          {error ? <article className={`${styles.card} ${styles.full}`}><h2>Diagnostics unavailable</h2><p className={styles.muted}>{error}</p></article> : null}
          {status ? <article className={`${styles.card} ${styles.full}`}><h2>Raw diagnostics</h2><pre className={styles.log}>{JSON.stringify(status, null, 2)}</pre></article> : null}
        </section>
      ) : null}
    </main>
  );
}
