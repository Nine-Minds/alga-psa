'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './status.module.css';

type RawTierMap = Record<string, boolean | { ready?: boolean; status?: string }>;
type Blocker = { severity?: string; component?: string; layer?: string; reason?: string; nextAction?: string; loginBlocking?: boolean };
type EventItem = { type?: string; reason?: string; namespace?: string; involvedObject?: string; message?: string; timestamp?: string | null };
type StatusResponse = {
  status?: string;
  rollup?: { state?: string; message?: string; nextAction?: string } | null;
  currentPhase?: string;
  urls?: { statusUrl?: string | null; loginUrl?: string | null };
  activeOperations?: Array<{ component?: string; image?: string | null; message?: string; elapsedSeconds?: number | null }>;
  tiers?: RawTierMap;
  readinessTiers?: RawTierMap;
  topBlockers?: Blocker[];
  failures?: Array<{ category?: string; phase?: string; suspectedCause?: string; suggestedNextStep?: string }>;
  bootstrap?: { job?: { name?: string | null; state?: string; failed?: boolean; completed?: boolean }; logs?: { available?: boolean; tail?: string[]; detectedErrors?: string[] } };
  recentEvents?: EventItem[];
  installState?: { status?: string; phase?: string; lastAction?: string; updatedAt?: string };
  kubernetes?: { nodes?: Array<{ name?: string; ready?: boolean }>; podCount?: number; jobCount?: number; helmReleaseCount?: number; warnings?: string[] };
  diagnostics?: Array<{ name?: string; ok?: boolean; status?: number; command?: string; stdout?: string; stderr?: string }>;
};

type NamespaceItem = { name: string; phase?: string };
type Deployment = {
  namespace: string; name: string; readyReplicas: number; replicas: number; updatedReplicas: number; availableReplicas: number;
  generation: number; observedGeneration: number; strategy?: string; images?: string[]; revision?: string | null;
  conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  replicaSets?: Array<{ name: string; revision?: string | null; replicas: number; readyReplicas: number; availableReplicas: number; createdAt?: string | null; images?: string[] }>;
};
type Pod = {
  namespace: string; name: string; phase: string; reason?: string | null; ready: boolean; readyContainers: number; totalContainers: number;
  restarts: number; node?: string | null; podIP?: string | null; createdAt?: string | null;
  containers: Array<{ name: string; image?: string; ready?: boolean; restarts?: number; state?: Record<string, unknown> | null }>;
};

type Tab = 'overview' | 'deployments' | 'pods' | 'logs' | 'diagnostics';

function tokenQuery() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function withToken(path: string, query: string) {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query.slice(1)}` : `${path}${query}`;
}

function apiPath(path: string, query: string, params: Record<string, string | number | boolean | null | undefined> = {}) {
  const search = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function badgeClass(value?: string | boolean) {
  const normalized = String(value ?? 'unknown');
  if (['true', 'fully_healthy', 'ready_to_log_in', 'ready_with_background_issues', 'healthy', 'Running', 'Succeeded', 'ready', 'True'].includes(normalized)) return styles.ready;
  if (['installing', 'progressing', 'unknown', 'Pending', 'ContainerCreating', 'PodInitializing', 'setup-queued', 'not_fully_healthy'].includes(normalized)) return styles.installing;
  if (['warning', 'background', 'degraded_background_services', 'Unknown'].includes(normalized)) return styles.warning;
  return styles.failed;
}

function tierEntries(status: StatusResponse | null) {
  const source = status?.readinessTiers || status?.tiers || {};
  return Object.entries(source).map(([name, value]) => {
    if (typeof value === 'boolean') return [name, { ready: value, status: value ? 'ready' : 'not ready' }] as const;
    return [name, { ready: Boolean(value?.ready), status: value?.status || (value?.ready ? 'ready' : 'not ready') }] as const;
  });
}

function blockers(status: StatusResponse | null): Blocker[] {
  if (status?.topBlockers?.length) return status.topBlockers;
  return (status?.failures || []).map((failure) => ({
    severity: failure.category === 'background-services' ? 'background' : 'critical',
    component: failure.category,
    layer: failure.phase,
    reason: failure.suspectedCause,
    nextAction: failure.suggestedNextStep,
    loginBlocking: failure.category !== 'background-services'
  }));
}

function ageFrom(date?: string | null) {
  if (!date) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function highlightLine(line: string, search: string) {
  if (!search) return line;
  const idx = line.toLowerCase().indexOf(search.toLowerCase());
  if (idx < 0) return line;
  return <>{line.slice(0, idx)}<mark>{line.slice(idx, idx + search.length)}</mark>{line.slice(idx + search.length)}</>;
}

export default function StatusPage() {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [namespace, setNamespace] = useState('msp');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [selectedPod, setSelectedPod] = useState('');
  const [selectedContainer, setSelectedContainer] = useState('');
  const [deploymentFilter, setDeploymentFilter] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [logTail, setLogTail] = useState(200);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logPaneRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    setQuery(tokenQuery());
  }, []);

  const loadStatus = useCallback(async () => {
    if (!query) return;
    try {
      const response = await fetch(apiPath('/api/status', query), { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Unauthorized: check the setup token.' : 'Status API unavailable.');
      setStatus(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [query]);

  const loadNamespaces = useCallback(async () => {
    if (!query) return;
    try {
      const response = await fetch(apiPath('/api/k8s/namespaces', query), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setNamespaces(data.namespaces || []);
    } catch { /* cluster may not exist yet */ }
  }, [query]);

  const loadPods = useCallback(async () => {
    if (!query) return;
    try {
      const response = await fetch(apiPath('/api/k8s/pods', query, { namespace }), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const nextPods = data.pods || [];
      setPods(nextPods);
      if (!selectedPod && nextPods.length) {
        setSelectedPod(nextPods[0].name);
        setSelectedContainer(nextPods[0].containers?.[0]?.name || '');
      }
    } catch { /* ignore transient Kubernetes failures */ }
  }, [namespace, query, selectedPod]);

  const loadDeployments = useCallback(async () => {
    if (!query) return;
    try {
      const response = await fetch(apiPath('/api/k8s/deployments', query, { namespace }), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setDeployments(data.deployments || []);
    } catch { /* ignore transient Kubernetes failures */ }
  }, [namespace, query]);

  const loadLogs = useCallback(async (tail = logTail) => {
    if (!query || !selectedPod) return;
    setLoadingLogs(true);
    try {
      setLogError(null);
      const response = await fetch(apiPath('/api/k8s/logs', query, { namespace, pod: selectedPod, container: selectedContainer, tail }), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to read logs.');
      const data = await response.json();
      setLogLines(data.lines || []);
      setLogTail(tail);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLogs(false);
    }
  }, [logTail, namespace, query, selectedContainer, selectedPod]);

  useEffect(() => {
    loadStatus();
    loadNamespaces();
    const timer = setInterval(loadStatus, 15000);
    return () => clearInterval(timer);
  }, [loadNamespaces, loadStatus]);

  useEffect(() => {
    if (activeTab === 'deployments') loadDeployments();
    if (activeTab === 'pods' || activeTab === 'logs') loadPods();
  }, [activeTab, loadDeployments, loadPods]);

  useEffect(() => {
    if (activeTab === 'logs') loadLogs(200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, namespace, selectedPod, selectedContainer]);

  const selectedPodData = pods.find((pod) => pod.name === selectedPod);
  const visibleDeployments = deployments.filter((deployment) => `${deployment.namespace}/${deployment.name} ${deployment.images?.join(' ')}`.toLowerCase().includes(deploymentFilter.toLowerCase()));
  const visiblePods = pods.filter((pod) => `${pod.namespace}/${pod.name} ${pod.phase} ${pod.containers.map((c) => c.image).join(' ')}`.toLowerCase().includes(podFilter.toLowerCase()));
  const filteredLogLines = logLines.filter((line) => !logFilter || line.toLowerCase().includes(logFilter.toLowerCase()));
  const searchMatches = logSearch ? filteredLogLines.filter((line) => line.toLowerCase().includes(logSearch.toLowerCase())).length : 0;
  const state = status?.rollup?.state || status?.status || status?.installState?.status || 'loading';

  function handleLogScroll() {
    const pane = logPaneRef.current;
    if (!pane || loadingLogs || pane.scrollTop > 80 || logTail >= 10000) return;
    loadLogs(logTail + 200);
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><span className={styles.logo}>A</span><span>Appliance Control</span></div>
        <nav className={styles.nav} aria-label="Appliance status tabs">
          {(['overview', 'deployments', 'pods', 'logs', 'diagnostics'] as Tab[]).map((tab) => (
            <button key={tab} className={activeTab === tab ? styles.activeTab : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </nav>
        <a className={styles.setupLink} href={withToken('/setup/', query)}>Setup</a>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.commandBar}>
          <div>
            <div className={styles.eyebrow}>Alga PSA appliance</div>
            <h1>{status?.rollup?.message || error || 'Reading live appliance status…'}</h1>
          </div>
          <span className={`${styles.statusPill} ${badgeClass(state)}`}>{state}</span>
        </header>

        {activeTab === 'overview' ? (
          <div className={styles.grid}>
            <article className={`${styles.panel} ${styles.wide}`}>
              <h2>Install overview</h2>
              <dl className={styles.kv}>
                <div><dt>Current phase</dt><dd>{status?.currentPhase || status?.installState?.phase || 'loading'}</dd></div>
                <div><dt>Last action</dt><dd>{status?.installState?.lastAction || status?.rollup?.nextAction || '—'}</dd></div>
                <div><dt>Login URL</dt><dd>{status?.urls?.loginUrl || 'Not available yet'}</dd></div>
                <div><dt>Cluster objects</dt><dd>{status?.kubernetes?.podCount ?? 0} pods · {status?.kubernetes?.helmReleaseCount ?? 0} releases</dd></div>
              </dl>
            </article>

            <article className={styles.panel}>
              <h2>Readiness tiers</h2>
              <div className={styles.tiers}>{tierEntries(status).map(([name, tier]) => (
                <div className={styles.tier} key={name}><strong>{name}</strong><span className={`${styles.badge} ${badgeClass(tier.ready)}`}>{tier.ready ? 'ready' : 'not ready'}</span><small>{tier.status}</small></div>
              ))}</div>
            </article>

            <article className={styles.panel}>
              <h2>Blockers</h2>
              {blockers(status).length === 0 ? <p className={styles.muted}>No action-required blockers detected from the live API.</p> : blockers(status).map((blocker, index) => (
                <div className={`${styles.blocker} ${blocker.loginBlocking === false ? styles.backgroundBlocker : ''}`} key={index}>
                  <strong>{blocker.component || blocker.layer}</strong><p>{blocker.reason}</p><small>{blocker.nextAction}</small>
                </div>
              ))}
            </article>

            <article className={styles.panel}>
              <h2>Active operations</h2>
              {(status?.activeOperations || []).length === 0 ? <p className={styles.muted}>No active image pull or long-running pod operation detected.</p> : status?.activeOperations?.map((op, index) => (
                <div className={styles.operation} key={index}><strong>{op.component}</strong><p>{op.message}</p></div>
              ))}
            </article>

            <article className={`${styles.panel} ${styles.wide}`}>
              <h2>Recent Kubernetes events</h2>
              <div className={styles.eventList}>{(status?.recentEvents || []).slice(-10).reverse().map((event, index) => (
                <div className={styles.event} key={index}><b>{event.type} {event.reason}</b><span>{event.namespace} · {event.involvedObject}</span><p>{event.message}</p></div>
              ))}{(status?.recentEvents || []).length === 0 ? <p className={styles.muted}>Kubernetes events are not available yet.</p> : null}</div>
            </article>
          </div>
        ) : null}

        {activeTab === 'deployments' ? (
          <section className={styles.panel}>
            <Toolbar namespace={namespace} namespaces={namespaces} onNamespace={setNamespace} filter={deploymentFilter} onFilter={setDeploymentFilter} onRefresh={loadDeployments} />
            <div className={styles.tableWrap}><table><thead><tr><th>Deployment</th><th>Ready</th><th>Revision</th><th>Strategy</th><th>Images</th><th>History</th></tr></thead><tbody>{visibleDeployments.map((deployment) => (
              <tr key={`${deployment.namespace}/${deployment.name}`}><td><b>{deployment.name}</b><small>{deployment.namespace}</small></td><td><span className={`${styles.badge} ${badgeClass(deployment.readyReplicas === deployment.replicas)}`}>{deployment.readyReplicas}/{deployment.replicas}</span></td><td>{deployment.revision || '—'}</td><td>{deployment.strategy}</td><td>{deployment.images?.map((image) => <code key={image}>{image}</code>)}</td><td><div className={styles.history}>{deployment.replicaSets?.slice(0, 4).map((rs) => <span key={rs.name}>r{rs.revision || '?'} {rs.readyReplicas}/{rs.replicas} · {ageFrom(rs.createdAt)}</span>)}</div></td></tr>
            ))}</tbody></table></div>
          </section>
        ) : null}

        {activeTab === 'pods' ? (
          <section className={styles.panel}>
            <Toolbar namespace={namespace} namespaces={namespaces} onNamespace={setNamespace} filter={podFilter} onFilter={setPodFilter} onRefresh={loadPods} />
            <div className={styles.tableWrap}><table><thead><tr><th>Pod</th><th>Status</th><th>Ready</th><th>Restarts</th><th>Node/IP</th><th>Containers</th></tr></thead><tbody>{visiblePods.map((pod) => (
              <tr key={`${pod.namespace}/${pod.name}`} onClick={() => { setNamespace(pod.namespace); setSelectedPod(pod.name); setSelectedContainer(pod.containers[0]?.name || ''); setActiveTab('logs'); }}><td><b>{pod.name}</b><small>{pod.namespace}</small></td><td><span className={`${styles.badge} ${badgeClass(pod.phase)}`}>{pod.phase}</span></td><td>{pod.readyContainers}/{pod.totalContainers}</td><td>{pod.restarts}</td><td><small>{pod.node || '—'}<br />{pod.podIP || '—'}</small></td><td>{pod.containers.map((container) => <code key={container.name}>{container.name}</code>)}</td></tr>
            ))}</tbody></table></div>
          </section>
        ) : null}

        {activeTab === 'logs' ? (
          <section className={styles.panel}>
            <div className={styles.logControls}>
              <select value={namespace} onChange={(event) => { setNamespace(event.target.value); setSelectedPod(''); }}><option value="msp">msp</option>{namespaces.filter((ns) => ns.name !== 'msp').map((ns) => <option key={ns.name} value={ns.name}>{ns.name}</option>)}</select>
              <select value={selectedPod} onChange={(event) => { setSelectedPod(event.target.value); setSelectedContainer(''); }}>{pods.map((pod) => <option key={pod.name} value={pod.name}>{pod.name}</option>)}</select>
              <select value={selectedContainer} onChange={(event) => setSelectedContainer(event.target.value)}>{(selectedPodData?.containers || []).map((container) => <option key={container.name} value={container.name}>{container.name}</option>)}</select>
              <button onClick={() => loadLogs(logTail)}>Refresh</button>
              <span className={styles.muted}>tail {logTail} · scroll up for older lines</span>
            </div>
            <div className={styles.logControls}>
              <input value={logFilter} onChange={(event) => setLogFilter(event.target.value)} placeholder="Filter visible log lines" />
              <input value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="Search and highlight" />
              <span className={styles.matchCount}>{searchMatches} matches</span>
            </div>
            {logError ? <div className={styles.alert}>{logError}</div> : null}
            <pre className={styles.logPane} ref={logPaneRef} onScroll={handleLogScroll}>{filteredLogLines.map((line, index) => <div key={`${index}-${line.slice(0, 20)}`} className={logSearch && line.toLowerCase().includes(logSearch.toLowerCase()) ? styles.matchLine : ''}>{highlightLine(line, logSearch)}</div>)}</pre>
          </section>
        ) : null}

        {activeTab === 'diagnostics' ? (
          <section className={styles.panel}><h2>Raw status payload</h2><pre className={styles.raw}>{JSON.stringify(status || { error }, null, 2)}</pre></section>
        ) : null}
      </section>
    </main>
  );
}

function Toolbar({ namespace, namespaces, onNamespace, filter, onFilter, onRefresh }: { namespace: string; namespaces: NamespaceItem[]; onNamespace: (value: string) => void; filter: string; onFilter: (value: string) => void; onRefresh: () => void }) {
  return <div className={styles.toolbar}><select value={namespace} onChange={(event) => onNamespace(event.target.value)}><option value="all">all namespaces</option><option value="msp">msp</option>{namespaces.filter((ns) => ns.name !== 'msp').map((ns) => <option key={ns.name} value={ns.name}>{ns.name}</option>)}</select><input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter by name, image, state…" /><button onClick={onRefresh}>Refresh</button></div>;
}
