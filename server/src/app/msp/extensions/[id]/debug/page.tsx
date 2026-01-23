'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';

type DebugEvent = {
  ts?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  stream?: 'stdout' | 'stderr' | 'log';
  tenantId?: string;
  extensionId?: string;
  installId?: string;
  requestId?: string;
  versionId?: string;
  contentHash?: string;
  message?: string;
  fields?: Record<string, unknown>;
  truncated?: boolean;
  [key: string]: unknown;
};

type EventWithId = DebugEvent & { __id: string };

type StreamMode = 'sse' | 'polling';

function classifyLine(e: DebugEvent): { label: string; className: string } {
  const stream = e.stream || 'log';
  const level = (e.level || 'info').toLowerCase();

  if (stream === 'stderr') {
    return { label: 'stderr', className: 'bg-red-50 text-red-800 border-red-100' };
  }
  if (stream === 'stdout') {
    return { label: 'stdout', className: 'bg-slate-50 text-slate-800 border-slate-100' };
  }

  switch (level) {
    case 'error':
      return { label: 'log:error', className: 'bg-red-50 text-red-800 border-red-100' };
    case 'warn':
      return { label: 'log:warn', className: 'bg-amber-50 text-amber-800 border-amber-100' };
    case 'debug':
      return { label: 'log:debug', className: 'bg-slate-50 text-slate-700 border-slate-100' };
    default:
      return { label: 'log', className: 'bg-slate-50 text-slate-800 border-slate-100' };
  }
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[1]?.replace('Z', '') ?? '';
}

function buildStreamUrl(extensionId: string, opts: {
  tenantId?: string | null;
  installId?: string | null;
  requestId?: string | null;
}) {
  const url = new URL('/api/ext-debug/stream', window.location.origin);
  url.searchParams.set('extensionId', extensionId);
  if (opts.tenantId) url.searchParams.set('tenantId', opts.tenantId);
  if (opts.installId) url.searchParams.set('installId', opts.installId);
  if (opts.requestId) url.searchParams.set('requestId', opts.requestId);
  return url.toString();
}

export default function ExtensionDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next.js App Router now provides `params` as a Promise; unwrap it once on the client.
  const [extensionId, setExtensionId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await params;
        if (!cancelled) {
          setExtensionId(resolved.id);
        }
      } catch (err) {
        console.error('[ext-debug] failed to resolve params', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const searchParams = useSearchParams();
  const router = useRouter();

  // tenantId is intentionally NOT user-editable in this multi-tenant view.
  // The backend derives the effective tenant from the authenticated session.
  const [installId, setInstallId] = useState<string>(searchParams?.get('installId') ?? '');
  const [requestId, setRequestId] = useState<string>(searchParams?.get('requestId') ?? '');
  const [tenantId, setTenantId] = useState<string>(searchParams?.get('tenantId') ?? '');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);
  const [showLogs, setShowLogs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventWithId[]>([]);
  const [streamMode, setStreamMode] = useState<StreamMode>('sse');
  const [sseAvailable, setSseAvailable] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollIdRef = useRef<string>('0');

  const effectiveInstallId = useMemo(
    () => installId.trim() || undefined,
    [installId],
  );
  const effectiveRequestId = useMemo(
    () => requestId.trim() || undefined,
    [requestId],
  );
  const effectiveTenantId = useMemo(
    () => tenantId.trim() || undefined,
    [tenantId],
  );

  // Keep URL query params in sync for shareable links
  useEffect(() => {
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value?: string) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    setOrDelete('installId', effectiveInstallId);
    setOrDelete('requestId', effectiveRequestId);
    setOrDelete('tenantId', effectiveTenantId);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [effectiveInstallId, effectiveRequestId, effectiveTenantId, router]);

  // Auto-scroll
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const filteredEvents = useMemo(
    () =>
      events.filter((e) => {
        if (!showStdout && e.stream === 'stdout') return false;
        if (!showStderr && e.stream === 'stderr') return false;
        if (!showLogs && (!e.stream || e.stream === 'log')) return false;
        return true;
      }),
    [events, showStdout, showStderr, showLogs],
  );

  const addEvents = useCallback((newEvents: DebugEvent[]) => {
    setEvents((prev) => {
      const eventsWithIds: EventWithId[] = newEvents.map((data) => ({
        ...data,
        __id:
          (data.requestId || '') +
          ':' +
          (data.ts || '') +
          ':' +
          Math.random().toString(36).slice(2),
      }));
      const next = [...prev, ...eventsWithIds];
      if (next.length > 2000) {
        return next.slice(next.length - 2000);
      }
      return next;
    });
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    lastPollIdRef.current = '0';

    const poll = async () => {
      try {
        const url = buildStreamUrl(extensionId, {
          installId: effectiveInstallId || null,
          requestId: effectiveRequestId || null,
          tenantId: effectiveTenantId || null,
        });

        console.log('[ext-debug] polling', url, 'lastId:', lastPollIdRef.current);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastId: lastPollIdRef.current }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[ext-debug] poll response:', data.events?.length || 0, 'events, lastId:', data.lastId);

        if (data.events && data.events.length > 0) {
          addEvents(data.events);
        }
        if (data.lastId) {
          lastPollIdRef.current = data.lastId;
        }
      } catch (err: any) {
        console.error('[ext-debug] poll error', err);
        // Don't disconnect on transient errors, just log
      }
    };

    // Initial poll
    void poll();

    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(poll, 2000);
  }, [extensionId, effectiveInstallId, effectiveRequestId, effectiveTenantId, addEvents]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startStream = (mode?: StreamMode) => {
    const useMode = mode ?? streamMode;

    // Cleanup any existing connections
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    stopPolling();

    setEvents([]);
    setError(null);
    setConnecting(true);
    setConnected(false);
    lastPollIdRef.current = '0';

    if (useMode === 'polling') {
      // Use polling mode
      startPolling();
      setConnecting(false);
      setConnected(true);
      return;
    }

    // SSE mode
    try {
      const url = buildStreamUrl(extensionId, {
        // Tenant is enforced server-side from the authenticated session.
        installId: effectiveInstallId || null,
        requestId: effectiveRequestId || null,
        tenantId: effectiveTenantId || null,
      });

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setConnecting(false);
        setConnected(true);
      };

      es.onerror = () => {
        setConnecting(false);
        setConnected(false);
        es.close();
        esRef.current = null;

        // Auto-fallback to polling if SSE fails
        setSseAvailable(false);
        setStreamMode('polling');
        setError(
          'SSE connection failed. Falling back to polling mode. Click "Start stream" to continue with polling.'
        );
      };

      es.onmessage = (event) => {
        try {
          const data = event.data ? JSON.parse(event.data) : null;
          if (!data) return;

          const ev: EventWithId = {
            ...data,
            __id:
              (data.requestId || data.request_id || '') +
              ':' +
              (data.ts || data.timestamp || '') +
              ':' +
              Math.random().toString(36).slice(2),
          };

          setEvents((prev) => {
            const next = [...prev, ev];
            if (next.length > 2000) {
              return next.slice(next.length - 2000);
            }
            return next;
          });
        } catch (err) {
          console.error('[ext-debug] failed to parse event', err);
        }
      };
    } catch (err: any) {
      setConnecting(false);
      setConnected(false);
      setError(`Failed to open debug stream: ${err?.message || String(err)}`);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    }
  };

  const stopStream = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    stopPolling();
    setConnected(false);
    setConnecting(false);
  };

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">
          Extension Debug Console
        </h1>
        <p className="text-sm text-slate-600">
          Live stdout/stderr and structured logs streamed from the runner for this
          extension. Use filters below to scope by tenant, install, or a specific
          request flow.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-slate-600">
            Extension ID
          </label>
          <input
            className="px-2 py-1 text-xs rounded border border-slate-200 bg-slate-50 text-slate-700"
            value={extensionId}
            disabled
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs font-medium text-slate-600">
            Install ID (optional, client-side filter)
          </label>
          <input
            className="px-2 py-1 text-xs rounded border border-slate-200"
            value={installId}
            onChange={(e) => setInstallId(e.target.value)}
            placeholder="Scope to one install"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs font-medium text-slate-600">
            Tenant ID (optional, admin override)
          </label>
          <input
            className="px-2 py-1 text-xs rounded border border-slate-200"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="Override tenant context"
          />
        </div>

        <div className="flex flex-col min-w-[200px]">
          <label className="text-xs font-medium text-slate-600">
            Request ID (optional, client-side filter)
          </label>
          <input
            className="px-2 py-1 text-xs rounded border border-slate-200"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="Match x-request-id / context.request_id"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={streamMode}
            onChange={(e) => setStreamMode(e.target.value as StreamMode)}
            disabled={connecting || connected}
            className="px-2 py-1.5 text-xs rounded border border-slate-200 bg-white"
            title={!sseAvailable ? 'SSE unavailable - using polling' : 'Select connection mode'}
          >
            <option value="sse" disabled={!sseAvailable}>
              SSE {!sseAvailable && '(unavailable)'}
            </option>
            <option value="polling">Polling</option>
          </select>
          <button
            type="button"
            onClick={() => startStream()}
            disabled={connecting || connected}
            className={`px-3 py-1.5 rounded text-xs font-medium text-white
              ${
                connecting
                  ? 'bg-slate-400 cursor-default'
                  : connected
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'
              }
              shadow-sm transition-colors`}
          >
            {connecting ? 'Connecting…' : 'Start stream'}
          </button>
          <button
            type="button"
            onClick={stopStream}
            disabled={!connected && !connecting}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => {
              setEvents([]);
              setError(null);
            }}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
          >
            Clear
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto text-xs text-slate-600">
          <Checkbox
            id="show-stdout"
            checked={showStdout}
            onChange={(e) => setShowStdout(e.target.checked)}
            label="stdout"
            containerClassName="mb-0"
          />
          <Checkbox
            id="show-stderr"
            checked={showStderr}
            onChange={(e) => setShowStderr(e.target.checked)}
            label="stderr"
            containerClassName="mb-0"
          />
          <Checkbox
            id="show-logs"
            checked={showLogs}
            onChange={(e) => setShowLogs(e.target.checked)}
            label="logs"
            containerClassName="mb-0"
          />
          <Checkbox
            id="auto-scroll"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            label="auto-scroll"
            containerClassName="mb-0"
          />
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
              connected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : connecting
                ? 'bg-amber-50 text-amber-700 border-amber-100'
                : 'bg-slate-50 text-slate-500 border-slate-100'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected
                  ? 'bg-emerald-500'
                  : connecting
                  ? 'bg-amber-400'
                  : 'bg-slate-400'
              }`}
            />
            {connected
              ? `${streamMode === 'polling' ? 'polling' : 'connected'}`
              : connecting
              ? 'connecting'
              : 'idle'}
          </span>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        className="mt-1 flex-1 min-h-[260px] max-h-[520px] overflow-y-auto rounded border border-slate-100 bg-white shadow-sm text-xs font-mono"
      >
        {filteredEvents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 text-slate-400">
            <div className="text-[11px]">
              No debug events yet. Start the stream and invoke your extension.
            </div>
            <div className="text-[10px] max-w-md text-center">
              Ensure the runner debug stream is enabled and that your extension
              logs via the provided logging APIs (alga.log) or stderr for
              errors.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {filteredEvents.map((e) => {
              const { label, className } = classifyLine(e);
              const ts = formatTimestamp(
                (e as any).ts || (e as any).timestamp || undefined,
              );
              const reqId =
                e.requestId ||
                (e as any).request_id ||
                (e as any).context?.request_id;
              const msg =
                e.message ??
                (typeof (e as any).body === 'string'
                  ? (e as any).body
                  : JSON.stringify(e));

              return (
                <li
                  key={e.__id}
                  className={`px-2 py-1.5 flex flex-col gap-0.5 border-l-2 ${className}`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    {ts && <span className="tabular-nums">{ts}</span>}
                    <span className="px-1 py-0.5 rounded bg-slate-900/5 text-slate-700 text-[9px] uppercase tracking-wide">
                      {label}
                    </span>
                    {reqId && (
                      <span className="truncate text-[9px] text-slate-500">
                        req:{' '}
                        <span className="font-semibold text-slate-700">
                          {reqId}
                        </span>
                      </span>
                    )}
                    {e.tenantId && (
                      <span className="hidden sm:inline text-[9px] text-slate-500">
                        tenant:{' '}
                        <span className="font-medium text-slate-700">
                          {e.tenantId}
                        </span>
                      </span>
                    )}
                    {e.installId && (
                      <span className="hidden sm:inline text-[9px] text-slate-500">
                        install:{' '}
                        <span className="font-medium text-slate-700">
                          {e.installId}
                        </span>
                      </span>
                    )}
                    {e.truncated && (
                      <span className="ml-1 text-[8px] text-amber-700">
                        [truncated]
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[10px] text-slate-800">
                    {msg}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-2 text-[10px] text-slate-500 space-y-1">
        <div className="font-semibold text-slate-600">
          How to use this console
        </div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            Start the extension runner with the debug stream enabled and service
            token configured so `/api/ext-debug/stream` can subscribe. If you see
            a connection error above, verify `RUNNER_BASE_URL` (or the configured
            runner endpoint) is reachable from this server.
          </li>
          <li>
            Use extension logging helpers (e.g. `alga.log`) rather than printing
            secrets; logs flow into this view when allowed.
          </li>
          <li>
            To follow a specific request flow, copy its request ID (e.g.
            `x-request-id` or `context.request_id`) into the Request ID filter
            and restart the stream.
          </li>
          <li>
            This console only shows logs for the caller's tenant context as
            enforced on the server; cross-tenant access is not possible from
            this UI.
          </li>
        </ul>
      </div>
    </div>
  );
}
