'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Boxes, ScrollText, Server, SlidersHorizontal } from 'lucide-react';
import { AlgaLogo } from './AlgaLogo';
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

type Tab = 'overview' | 'deployments' | 'pods' | 'logs';
type LogLoadOptions = { preserveScroll?: boolean; scrollToEnd?: boolean };

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
  if (['loading'].includes(normalized)) return styles.loading;
  if (['true', 'fully_healthy', 'ready_to_log_in', 'ready_with_background_issues', 'healthy', 'Running', 'Succeeded', 'ready', 'True'].includes(normalized)) return styles.ready;
  if (['installing', 'progressing', 'unknown', 'Pending', 'ContainerCreating', 'PodInitializing', 'setup-queued', 'not_fully_healthy'].includes(normalized)) return styles.installing;
  if (['false', 'not ready', 'warning', 'background', 'degraded_background_services', 'Unknown'].includes(normalized)) return styles.warning;
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

function elapsedLabel(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'elapsed time unavailable';
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s elapsed`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m elapsed`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m elapsed`;
}

const statusTabs = [
  { value: 'overview', label: 'Overview', Icon: Activity },
  { value: 'deployments', label: 'Deployments', Icon: Boxes },
  { value: 'pods', label: 'Pods', Icon: Server },
  { value: 'logs', label: 'Logs', Icon: ScrollText }
] satisfies Array<{ value: Tab; label: string; Icon: typeof Activity }>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightLine(line: string, search: string) {
  if (!search) return line;
  const parts = line.split(new RegExp(`(${escapeRegExp(search)})`, 'ig'));
  return <>{parts.map((part, index) => part.toLowerCase() === search.toLowerCase() ? <mark key={index}>{part}</mark> : part)}</>;
}

function SkeletonRows({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return <>{Array.from({ length: rows }).map((_, row) => <tr key={row} className={styles.skeletonRow}>{Array.from({ length: columns }).map((__, col) => <td key={col}><span className={styles.skeletonCell} /></td>)}</tr>)}</>;
}

function SkeletonBlock({ lines = 6 }: { lines?: number }) {
  return <div className={styles.skeletonBlock}>{Array.from({ length: lines }).map((_, index) => <span key={index} className={styles.skeletonLineDark} />)}</div>;
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
  const [activeMatch, setActiveMatch] = useState(0);
  const [logTail, setLogTail] = useState(200);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingNamespaces, setLoadingNamespaces] = useState(true);
  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const [loadingPods, setLoadingPods] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logPaneRef = useRef<HTMLPreElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pendingLogScroll = useRef<null | { mode: 'preserve' | 'end'; previousScrollHeight: number; previousScrollTop: number }>(null);
  const statusRequestInFlight = useRef(false);
  const statusAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(tokenQuery());
  }, []);

  const loadStatus = useCallback(async () => {
    if (!query || statusRequestInFlight.current) return;

    const controller = new AbortController();
    statusRequestInFlight.current = true;
    statusAbortController.current = controller;
    setLoadingStatus(true);
    try {
      const response = await fetch(apiPath('/api/status', query), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Unauthorized: check the setup token.' : 'Status API unavailable.');
      setStatus(await response.json());
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (statusAbortController.current === controller) {
        statusRequestInFlight.current = false;
        statusAbortController.current = null;
        setLoadingStatus(false);
      }
    }
  }, [query]);

  const loadNamespaces = useCallback(async () => {
    if (!query) return;
    setLoadingNamespaces(true);
    try {
      const response = await fetch(apiPath('/api/k8s/namespaces', query), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setNamespaces(data.namespaces || []);
    } catch { /* cluster may not exist yet */ }
    finally { setLoadingNamespaces(false); }
  }, [query]);

  const loadPods = useCallback(async () => {
    if (!query) return;
    setLoadingPods(true);
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
    finally { setLoadingPods(false); }
  }, [namespace, query, selectedPod]);

  const loadDeployments = useCallback(async () => {
    if (!query) return;
    setLoadingDeployments(true);
    try {
      const response = await fetch(apiPath('/api/k8s/deployments', query, { namespace }), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setDeployments(data.deployments || []);
    } catch { /* ignore transient Kubernetes failures */ }
    finally { setLoadingDeployments(false); }
  }, [namespace, query]);

  function applyPendingLogScroll() {
    const pending = pendingLogScroll.current;
    const pane = logPaneRef.current;
    if (!pending || !pane) return;
    if (pending.mode === 'end') {
      pane.scrollTop = pane.scrollHeight;
    } else {
      pane.scrollTop = pane.scrollHeight - pending.previousScrollHeight + pending.previousScrollTop;
    }
    pendingLogScroll.current = null;
  }

  const loadLogs = useCallback(async (tail = logTail, options: LogLoadOptions = {}) => {
    if (!query || !selectedPod) return;
    const pane = logPaneRef.current;
    const previousScrollHeight = pane?.scrollHeight || 0;
    const previousScrollTop = pane?.scrollTop || 0;
    setLoadingLogs(true);
    try {
      setLogError(null);
      const response = await fetch(apiPath('/api/k8s/logs', query, { namespace, pod: selectedPod, container: selectedContainer, tail }), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to read logs.');
      const data = await response.json();
      if (options.preserveScroll) {
        pendingLogScroll.current = { mode: 'preserve', previousScrollHeight, previousScrollTop };
      } else if (options.scrollToEnd) {
        pendingLogScroll.current = { mode: 'end', previousScrollHeight, previousScrollTop };
      }
      setLogLines(data.lines || []);
      setLogTail(tail);
      window.setTimeout(applyPendingLogScroll, 50);
      window.setTimeout(applyPendingLogScroll, 250);
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
    return () => {
      clearInterval(timer);
      statusAbortController.current?.abort();
    };
  }, [loadNamespaces, loadStatus]);

  useEffect(() => {
    if (activeTab === 'deployments') loadDeployments();
    if (activeTab === 'pods' || activeTab === 'logs') loadPods();
  }, [activeTab, loadDeployments, loadPods]);

  useEffect(() => {
    if (activeTab === 'logs') loadLogs(200, { scrollToEnd: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, namespace, selectedPod, selectedContainer]);

  useEffect(() => {
    requestAnimationFrame(applyPendingLogScroll);
  }, [logLines, loadingLogs, activeTab]);

  const selectedPodData = pods.find((pod) => pod.name === selectedPod);
  const visibleDeployments = deployments.filter((deployment) => `${deployment.namespace}/${deployment.name} ${deployment.images?.join(' ')}`.toLowerCase().includes(deploymentFilter.toLowerCase()));
  const visiblePods = pods.filter((pod) => `${pod.namespace}/${pod.name} ${pod.phase} ${pod.containers.map((c) => c.image).join(' ')}`.toLowerCase().includes(podFilter.toLowerCase()));
  const filteredLogLines = logLines.filter((line) => !logFilter || line.toLowerCase().includes(logFilter.toLowerCase()));
  const matchLineIndexes = useMemo(() => logSearch ? filteredLogLines.reduce<number[]>((matches, line, index) => {
    if (line.toLowerCase().includes(logSearch.toLowerCase())) matches.push(index);
    return matches;
  }, []) : [], [filteredLogLines, logSearch]);
  const searchMatches = matchLineIndexes.length;
  const state = status?.rollup?.state || status?.status || status?.installState?.status || 'loading';
  const blockerList = blockers(status);
  const runningOperations = status?.activeOperations || [];
  const primaryOperation = runningOperations[0];
  const currentPhase = status?.currentPhase || status?.installState?.phase || 'loading';
  const nextAction = status?.rollup?.nextAction || status?.installState?.lastAction || 'Waiting for the next appliance update';

  useEffect(() => {
    setActiveMatch(0);
  }, [logSearch, logFilter, logLines]);

  function handleLogScroll() {
    const pane = logPaneRef.current;
    if (!pane || loadingLogs || pane.scrollTop > 80 || logTail >= 10000) return;
    loadLogs(logTail + 200, { preserveScroll: true });
  }

  function jumpMatch(direction: 1 | -1) {
    if (searchMatches === 0) return;
    const next = (activeMatch + direction + searchMatches) % searchMatches;
    setActiveMatch(next);
    window.setTimeout(() => {
      lineRefs.current[matchLineIndexes[next]]?.scrollIntoView({ block: 'center' });
    }, 0);
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}><AlgaLogo className={styles.logoSvg} /></span>
          <span className={styles.brandText}><span>Alga PSA</span><small>Setup status</small></span>
        </div>
        <nav className={styles.nav} aria-label="Alga PSA setup status tabs" role="tablist">
          {statusTabs.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`appliance-tab-${value}`}
              aria-selected={activeTab === value}
              aria-controls={`appliance-panel-${value}`}
              className={activeTab === value ? styles.activeTab : ''}
              onClick={() => setActiveTab(value)}
            >
              <Icon className={styles.navIcon} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <a className={styles.setupLink} href={withToken('/setup/', query)}><SlidersHorizontal className={styles.navIcon} aria-hidden="true" /><span>Setup</span></a>
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
          <div id="appliance-panel-overview" role="tabpanel" aria-labelledby="appliance-tab-overview" className={styles.grid}>
            <article className={`${styles.panel} ${styles.wide}`}>
              <h2>What is running now</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={4} /> : (
                <div className={styles.runSummary}>
                  <div className={styles.runHeader}>
                    <div>
                      <strong>{primaryOperation?.component || currentPhase}</strong>
                      <p className={styles.runMessage}>{primaryOperation?.message || nextAction}</p>
                    </div>
                    <span className={`${styles.statusPill} ${badgeClass(state)}`}>{state}</span>
                  </div>
                  <div className={styles.runMeta}>
                    <span>Phase: {currentPhase}</span>
                    <span>{elapsedLabel(primaryOperation?.elapsedSeconds)}</span>
                    <span>Login: {status?.urls?.loginUrl ? 'available' : 'not available yet'}</span>
                    <span>{status?.kubernetes?.podCount ?? 0} pods</span>
                  </div>
                  {runningOperations.length > 1 ? (
                    <ul className={styles.runList} aria-label="Other active operations">
                      {runningOperations.slice(1, 4).map((op, index) => <li key={`${op.component}-${index}`}>{op.component}: {op.message}</li>)}
                    </ul>
                  ) : null}
                </div>
              )}
            </article>

            <article className={styles.panel}>
              <h2>Next checkpoint</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={4} /> : <dl className={styles.kv}>
                <div><dt>Current phase</dt><dd>{currentPhase}</dd></div>
                <div><dt>Next action</dt><dd>{nextAction}</dd></div>
                <div><dt>Login URL</dt><dd>{status?.urls?.loginUrl || 'Not available yet'}</dd></div>
                <div><dt>Cluster objects</dt><dd>{status?.kubernetes?.podCount ?? 0} pods · {status?.kubernetes?.helmReleaseCount ?? 0} releases</dd></div>
              </dl>}
            </article>

            <article className={styles.panel}>
              <h2>Blockers</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={3} /> : blockerList.length === 0 ? <p className={styles.muted}>No action-required blockers detected.</p> : blockerList.map((blocker, index) => (
                <div className={`${styles.blocker} ${blocker.loginBlocking === false ? styles.backgroundBlocker : ''}`} key={index}>
                  <strong>{blocker.component || blocker.layer}</strong><p>{blocker.reason}</p><small>{blocker.nextAction}</small>
                </div>
              ))}
            </article>

            <article className={styles.panel}>
              <h2>Readiness tiers</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={6} /> : <div className={styles.tiers}>{tierEntries(status).map(([name, tier]) => (
                <div className={styles.tier} key={name}><strong>{name}</strong><span className={`${styles.badge} ${badgeClass(tier.ready)}`}>{tier.ready ? 'ready' : 'not ready'}</span><small>{tier.status}</small></div>
              ))}</div>}
            </article>

            <article className={styles.panel}>
              <h2>Active operations</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={3} /> : runningOperations.length === 0 ? <p className={styles.muted}>No active image pull or long-running pod operation detected.</p> : runningOperations.map((op, index) => (
                <div className={styles.operation} key={index}><strong>{op.component}</strong><p>{op.message}</p></div>
              ))}
            </article>

            <article className={`${styles.panel} ${styles.wide}`}>
              <h2>Recent Kubernetes events</h2>
              {loadingStatus && !status ? <SkeletonBlock lines={5} /> : <div className={styles.eventList}>{(status?.recentEvents || []).slice(-10).reverse().map((event, index) => (
                <div className={styles.event} key={index}><b>{event.type} {event.reason}</b><span>{event.namespace} · {event.involvedObject}</span><p>{event.message}</p></div>
              ))}{(status?.recentEvents || []).length === 0 ? <p className={styles.muted}>Kubernetes events are not available yet.</p> : null}</div>}
            </article>

            <details className={styles.advancedSupport}>
              <summary className={styles.advancedSummary}>Advanced support diagnostics</summary>
              <p className={styles.helpText}>Use this raw payload when support asks for exact appliance state.</p>
              {loadingStatus && !status ? <SkeletonBlock lines={12} /> : <pre className={styles.raw}>{JSON.stringify(status || { error }, null, 2)}</pre>}
            </details>
          </div>
        ) : null}

        {activeTab === 'deployments' ? (
          <section id="appliance-panel-deployments" role="tabpanel" aria-labelledby="appliance-tab-deployments" className={styles.panel}>
            <Toolbar namespace={namespace} namespaces={namespaces} loadingNamespaces={loadingNamespaces} onNamespace={setNamespace} filter={deploymentFilter} onFilter={setDeploymentFilter} onRefresh={loadDeployments} />
            <div className={styles.tableWrap}><table><thead><tr><th>Deployment</th><th>Ready</th><th>Revision</th><th>Strategy</th><th>Images</th><th>History</th></tr></thead><tbody>{loadingDeployments ? <SkeletonRows columns={6} rows={7} /> : visibleDeployments.length === 0 ? <tr><td colSpan={6} className={styles.emptyCell}>No deployments found.</td></tr> : visibleDeployments.map((deployment) => (
              <tr key={`${deployment.namespace}/${deployment.name}`}><td><b>{deployment.name}</b><small>{deployment.namespace}</small></td><td><span className={`${styles.badge} ${badgeClass(deployment.readyReplicas === deployment.replicas)}`}>{deployment.readyReplicas}/{deployment.replicas}</span></td><td>{deployment.revision || '—'}</td><td>{deployment.strategy}</td><td>{deployment.images?.map((image) => <code key={image}>{image}</code>)}</td><td><div className={styles.history}>{deployment.replicaSets?.slice(0, 4).map((rs) => <span key={rs.name}>r{rs.revision || '?'} {rs.readyReplicas}/{rs.replicas} · {ageFrom(rs.createdAt)}</span>)}</div></td></tr>
            ))}</tbody></table></div>
          </section>
        ) : null}

        {activeTab === 'pods' ? (
          <section id="appliance-panel-pods" role="tabpanel" aria-labelledby="appliance-tab-pods" className={styles.panel}>
            <Toolbar namespace={namespace} namespaces={namespaces} loadingNamespaces={loadingNamespaces} onNamespace={setNamespace} filter={podFilter} onFilter={setPodFilter} onRefresh={loadPods} />
            <div className={styles.tableWrap}><table><thead><tr><th>Pod</th><th>Status</th><th>Ready</th><th>Restarts</th><th>Node/IP</th><th>Containers</th><th>Action</th></tr></thead><tbody>{loadingPods ? <SkeletonRows columns={7} rows={8} /> : visiblePods.length === 0 ? <tr><td colSpan={7} className={styles.emptyCell}>No pods found.</td></tr> : visiblePods.map((pod) => (
              <tr key={`${pod.namespace}/${pod.name}`} onClick={() => { setNamespace(pod.namespace); setSelectedPod(pod.name); setSelectedContainer(pod.containers[0]?.name || ''); setActiveTab('logs'); }}><td><b>{pod.name}</b><small>{pod.namespace}</small></td><td><span className={`${styles.badge} ${badgeClass(pod.phase)}`}>{pod.phase}</span></td><td>{pod.readyContainers}/{pod.totalContainers}</td><td>{pod.restarts}</td><td><small>{pod.node || '—'}<br />{pod.podIP || '—'}</small></td><td>{pod.containers.map((container) => <code key={container.name}>{container.name}</code>)}</td><td><button type="button" onClick={(event) => { event.stopPropagation(); setNamespace(pod.namespace); setSelectedPod(pod.name); setSelectedContainer(pod.containers[0]?.name || ''); setActiveTab('logs'); }}>View logs</button></td></tr>
            ))}</tbody></table></div>
          </section>
        ) : null}

        {activeTab === 'logs' ? (
          <section id="appliance-panel-logs" role="tabpanel" aria-labelledby="appliance-tab-logs" className={styles.panel}>
            <div className={styles.logControls}>
              <Dropdown ariaLabel="Namespace" value={namespace} disabled={loadingNamespaces} onChange={(value) => { setNamespace(value); setSelectedPod(''); }} options={[{ value: 'msp', label: 'msp' }, ...namespaces.filter((ns) => ns.name !== 'msp').map((ns) => ({ value: ns.name, label: ns.name }))]} />
              <Dropdown ariaLabel="Pod" value={selectedPod} disabled={loadingPods} placeholder="Select pod" onChange={(value) => { setSelectedPod(value); setSelectedContainer(''); }} options={pods.map((pod) => ({ value: pod.name, label: pod.name }))} />
              <Dropdown ariaLabel="Container" value={selectedContainer} disabled={loadingPods || !selectedPodData} placeholder="Select container" onChange={setSelectedContainer} options={(selectedPodData?.containers || []).map((container) => ({ value: container.name, label: container.name }))} />
              <button type="button" onClick={() => loadLogs(logTail, { scrollToEnd: true })}>Refresh</button>
              <span className={styles.muted}>tail {logTail} · scroll up for older lines</span>
            </div>
            <div className={styles.logControls}>
              <input aria-label="Filter visible log lines" value={logFilter} onChange={(event) => setLogFilter(event.target.value)} placeholder="Filter visible log lines" />
              <input aria-label="Search and highlight log lines" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="Search and highlight" />
              <button type="button" disabled={searchMatches === 0} onClick={() => jumpMatch(-1)}>Previous</button>
              <button type="button" disabled={searchMatches === 0} onClick={() => jumpMatch(1)}>Next</button>
              <span className={styles.matchCount}>{searchMatches ? `${activeMatch + 1}/${searchMatches}` : '0 matches'}</span>
            </div>
            {logError ? <div className={styles.alert}>{logError}</div> : null}
            {loadingLogs && logLines.length === 0 ? <div className={styles.logPane}><SkeletonBlock lines={18} /></div> : <pre className={styles.logPane} ref={logPaneRef} onScroll={handleLogScroll}>{filteredLogLines.map((line, index) => {
              const matchIndex = matchLineIndexes.indexOf(index);
              const isMatch = matchIndex >= 0;
              const isActive = isMatch && matchIndex === activeMatch;
              return <div ref={(el) => { lineRefs.current[index] = el; }} key={`${index}-${line.slice(0, 20)}`} className={`${isMatch ? styles.matchLine : ''} ${isActive ? styles.activeMatchLine : ''}`}>{highlightLine(line, logSearch)}</div>;
            })}</pre>}
          </section>
        ) : null}

      </section>
    </main>
  );
}

type DropdownOption = { value: string; label: string };

// Custom dropdown used instead of a native <select>. Native select popups are
// unreliable inside the Electron browser pane (they fail to open or are
// dismissed by the 15s status-poll re-render). This renders the option list in
// the page DOM and keeps its open state across parent re-renders.
function Dropdown({ value, options, onChange, disabled, ariaLabel, placeholder }: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return (
    <div className={styles.dropdown} ref={ref}>
      <button type="button" className={styles.dropdownButton} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen((prev) => !prev)}>
        <span className={styles.dropdownLabel}>{selected?.label ?? (value || placeholder || '—')}</span>
        <span className={styles.dropdownCaret} aria-hidden="true">▾</span>
      </button>
      {open && !disabled ? (
        <ul className={styles.dropdownMenu} role="listbox" aria-label={ariaLabel}>
          {options.length === 0 ? (
            <li className={styles.dropdownOption} aria-disabled="true">No options</li>
          ) : options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`${styles.dropdownOption} ${option.value === value ? styles.dropdownOptionActive : ''}`}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Toolbar({ namespace, namespaces, loadingNamespaces, onNamespace, filter, onFilter, onRefresh }: { namespace: string; namespaces: NamespaceItem[]; loadingNamespaces?: boolean; onNamespace: (value: string) => void; filter: string; onFilter: (value: string) => void; onRefresh: () => void }) {
  const options: DropdownOption[] = [
    { value: 'all', label: 'all namespaces' },
    { value: 'msp', label: 'msp' },
    ...namespaces.filter((ns) => ns.name !== 'msp').map((ns) => ({ value: ns.name, label: ns.name }))
  ];
  return <div className={styles.toolbar}><Dropdown ariaLabel="Namespace" value={namespace} disabled={loadingNamespaces} onChange={onNamespace} options={options} /><input aria-label="Filter by name, image, or state" value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter by name, image, state…" /><button type="button" onClick={onRefresh}>Refresh</button></div>;
}
