'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './status.module.css';

type Blocker = {
  component?: string;
  layer?: string;
  reason?: string;
  nextAction?: string;
  loginBlocking?: boolean;
};

type PodRow = {
  namespace: string;
  name: string;
  status: string;
  readyText: string;
  restarts: number;
  ageSeconds?: number | null;
  nodeName?: string | null;
  containers?: string[];
};

type StatusResponse = {
  status?: string;
  timestamp?: string;
  rollup?: { state?: string; message?: string; nextAction?: string };
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
};

function formatSeconds(value?: number | null) {
  if (value == null) return 'unknown';
  if (value < 60) return `${value}s`;
  return `${Math.floor(value / 60)}m ${value % 60}s`;
}

function badgeClass(value?: string) {
  const normalized = value || 'unknown';
  if (['fully_healthy', 'ready_to_log_in', 'ready_with_background_issues', 'healthy', 'Running', 'Succeeded'].includes(normalized)) return styles.ready;
  if (['installing', 'progressing', 'unknown', 'Pending', 'ContainerCreating', 'PodInitializing'].includes(normalized)) return styles.installing;
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

export default function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'pods' | 'diagnostics'>('overview');
  const [namespaceScope, setNamespaceScope] = useState('appliance');
  const [pods, setPods] = useState<PodRow[]>([]);
  const [selectedPod, setSelectedPod] = useState<PodRow | null>(null);
  const [selectedContainer, setSelectedContainer] = useState('');
  const [podLog, setPodLog] = useState<string[]>([]);
  const [podStatus, setPodStatus] = useState('Loading pods...');
  const [logStatus, setLogStatus] = useState('Select a pod to view logs.');
  const query = useMemo(tokenQuery, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/status${query}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unauthorized or status API unavailable');
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
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  useEffect(() => {
    if (activeTab !== 'pods') return undefined;
    let cancelled = false;
    async function loadPods() {
      try {
        const response = await fetch(withToken(`/api/pods?namespace=${encodeURIComponent(namespaceScope)}`, query), { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load pods');
        const data = (await response.json()) as { pods?: PodRow[] };
        if (!cancelled) {
          const rows = data.pods || [];
          setPods(rows);
          setPodStatus(`${rows.length} pods loaded.`);
          if (selectedPod && !rows.some((pod) => pod.namespace === selectedPod.namespace && pod.name === selectedPod.name)) {
            setSelectedPod(null);
            setPodLog([]);
            setLogStatus('Select a pod to view logs.');
          }
        }
      } catch (err) {
        if (!cancelled) setPodStatus(err instanceof Error ? err.message : String(err));
      }
    }
    loadPods();
    const timer = setInterval(loadPods, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, namespaceScope, query, selectedPod]);

  useEffect(() => {
    if (activeTab !== 'pods' || !selectedPod) return undefined;
    let cancelled = false;
    async function loadLogs() {
      const pod = selectedPod;
      if (!pod) return;
      const container = selectedContainer || pod.containers?.[0] || '';
      const params = new URLSearchParams({
        namespace: pod.namespace,
        pod: pod.name,
        container,
        tailLines: '300',
      });
      try {
        const response = await fetch(withToken(`/api/pods/logs?${params.toString()}`, query), { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load pod logs');
        const data = (await response.json()) as { available?: boolean; lines?: string[] };
        if (!cancelled) {
          setPodLog(data.lines || []);
          setLogStatus(`${data.available ? 'Loaded' : 'No logs available'} for ${pod.namespace}/${pod.name}${container ? ` / ${container}` : ''}.`);
        }
      } catch (err) {
        if (!cancelled) setLogStatus(err instanceof Error ? err.message : String(err));
      }
    }
    loadLogs();
    const timer = setInterval(loadLogs, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, query, selectedContainer, selectedPod]);

  const state = status?.rollup?.state || status?.status || 'loading';
  const operations = status?.activeOperations || [];
  const logs = status?.bootstrap?.logs;
  const detectedError = logs?.detectedErrors?.at(-1);

  function choosePod(pod: PodRow) {
    setSelectedPod(pod);
    setSelectedContainer(pod.containers?.[0] || '');
    setPodLog([]);
    setLogStatus(`Loading logs for ${pod.namespace}/${pod.name}...`);
  }

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Alga PSA Appliance</div>
        <h1>Install status</h1>
        <p>{error || status?.rollup?.message || 'Loading status...'}</p>
      </section>

      <nav className={styles.tabs} aria-label="Appliance status tabs">
        <button className={activeTab === 'overview' ? styles.activeTab : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={activeTab === 'pods' ? styles.activeTab : ''} onClick={() => setActiveTab('pods')}>Pods</button>
        <button className={activeTab === 'diagnostics' ? styles.activeTab : ''} onClick={() => setActiveTab('diagnostics')}>Diagnostics</button>
      </nav>

      {activeTab === 'overview' ? (
        <section className={styles.grid}>
          <article className={`${styles.card} ${styles.overview}`}>
            <h2>Overview</h2>
            <dl className={styles.kv}>
              <div><dt>Install state</dt><dd><span className={`${styles.badge} ${badgeClass(state)}`}>{state}</span></dd></div>
              <div><dt>Current phase</dt><dd>{status?.currentPhase || state}</dd></div>
              <div><dt>Login URL</dt><dd>{status?.urls?.loginUrl || 'Not available yet'}</dd></div>
              <div><dt>Next action</dt><dd>{status?.rollup?.nextAction || '-'}</dd></div>
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
              {Object.entries(status?.tiers || {}).map(([name, tier]) => (
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
            {(status?.topBlockers || []).length === 0 ? <p className={styles.muted}>No action-required blockers detected.</p> : status?.topBlockers?.map((blocker, index) => (
              <div className={styles.blocker} key={`${blocker.component}-${index}`}>
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
            ) : <p className={styles.muted}>{status?.bootstrap?.job?.name ? `No log excerpt available for ${status.bootstrap.job.name}.` : 'No bootstrap job log available yet.'}</p>}
          </article>

          <article className={`${styles.card} ${styles.full}`}>
            <h2>Recent events</h2>
            <div className={styles.events}>
              {(status?.recentEvents || []).slice(-8).reverse().map((event, index) => (
                <div className={styles.event} key={`${event.reason}-${index}`}>
                  <strong>{event.type} {event.reason}</strong>
                  <span>{event.namespace} {event.involvedObject}</span>
                  <p>{event.message}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'pods' ? (
        <section className={styles.grid}>
          <article className={`${styles.card} ${styles.full}`}>
            <div className={styles.toolbar}>
              <h2>Pods</h2>
              <label className={styles.muted}>Namespace{' '}
                <select value={namespaceScope} onChange={(event) => setNamespaceScope(event.target.value)}>
                  <option value="appliance">Appliance namespaces</option>
                  <option value="all">All namespaces</option>
                  <option value="msp">msp</option>
                  <option value="alga-system">alga-system</option>
                  <option value="appliance-system">appliance-system</option>
                  <option value="flux-system">flux-system</option>
                  <option value="local-path-storage">local-path-storage</option>
                  <option value="kube-system">kube-system</option>
                </select>
              </label>
            </div>
            <p className={styles.muted}>{podStatus}</p>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Namespace</th><th>Pod</th><th>Status</th><th>Ready</th><th>Restarts</th><th>Age</th><th>Node</th></tr></thead>
                <tbody>
                  {pods.map((pod) => (
                    <tr key={`${pod.namespace}/${pod.name}`} onClick={() => choosePod(pod)} className={selectedPod?.namespace === pod.namespace && selectedPod?.name === pod.name ? styles.selectedRow : ''}>
                      <td>{pod.namespace}</td>
                      <td>{pod.name}</td>
                      <td><span className={`${styles.badge} ${badgeClass(pod.status)}`}>{pod.status}</span></td>
                      <td>{pod.readyText}</td>
                      <td>{pod.restarts}</td>
                      <td>{formatSeconds(pod.ageSeconds)}</td>
                      <td>{pod.nodeName || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className={`${styles.card} ${styles.full}`}>
            <div className={styles.toolbar}>
              <h2>{selectedPod ? `Logs: ${selectedPod.namespace}/${selectedPod.name}` : 'Pod logs'}</h2>
              <label className={styles.muted}>Container{' '}
                <select value={selectedContainer} onChange={(event) => setSelectedContainer(event.target.value)} disabled={!selectedPod}>
                  {(selectedPod?.containers || []).map((container) => <option key={container} value={container}>{container}</option>)}
                </select>
              </label>
            </div>
            <p className={styles.muted}>{logStatus}</p>
            {selectedPod ? <pre className={styles.log}>{podLog.join('\n')}</pre> : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'diagnostics' ? (
        <section className={styles.grid}>
          <article className={`${styles.card} ${styles.full}`}>
            <h2>Diagnostics</h2>
            <pre className={styles.log}>{JSON.stringify(status, null, 2)}</pre>
          </article>
        </section>
      ) : null}
    </main>
  );
}
