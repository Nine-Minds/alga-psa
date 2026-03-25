import { ShellRunner } from './runner.mjs';

const DEFAULT_NAMESPACES = ['msp', 'alga-system', 'flux-system'];

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (value < 60) {
    return `${value}s`;
  }
  if (value < 3600) {
    return `${Math.floor(value / 60)}m`;
  }
  if (value < 86400) {
    return `${Math.floor(value / 3600)}h`;
  }
  return `${Math.floor(value / 86400)}d`;
}

function toTimestamp(text) {
  const value = Date.parse(String(text || ''));
  if (Number.isNaN(value)) {
    return null;
  }
  return value;
}

function podReadyCount(item) {
  const statuses = item?.status?.containerStatuses || [];
  const total = statuses.length || item?.spec?.containers?.length || 0;
  const ready = statuses.reduce((count, status) => (status.ready ? count + 1 : count), 0);
  return { ready, total };
}

function podRestartCount(item) {
  const statuses = item?.status?.containerStatuses || [];
  return statuses.reduce((count, status) => count + Number(status.restartCount || 0), 0);
}

function podDisplayStatus(item) {
  if (item?.metadata?.deletionTimestamp) {
    return 'Terminating';
  }

  for (const status of item?.status?.containerStatuses || []) {
    const waitingReason = status?.state?.waiting?.reason;
    if (waitingReason) {
      return waitingReason;
    }
    const terminatedReason = status?.state?.terminated?.reason;
    if (terminatedReason) {
      return terminatedReason;
    }
  }

  return item?.status?.phase || 'Unknown';
}

function summarizePod(item, nowMs) {
  const namespace = item?.metadata?.namespace || 'default';
  const name = item?.metadata?.name || 'unknown';
  const startedAt = toTimestamp(item?.status?.startTime) ?? toTimestamp(item?.metadata?.creationTimestamp) ?? nowMs;
  const ageSeconds = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const readiness = podReadyCount(item);
  const restarts = podRestartCount(item);

  return {
    key: `${namespace}/${name}`,
    namespace,
    name,
    phase: item?.status?.phase || 'Unknown',
    status: podDisplayStatus(item),
    ready: `${readiness.ready}/${readiness.total}`,
    restarts,
    age: formatDuration(ageSeconds),
    ageSeconds,
  };
}

export async function listAppliancePods(env, options = {}) {
  const shell = options.runner || new ShellRunner({ cwd: env.runtime.assetRoot });
  const kubeconfig = options.kubeconfig || env.paths.kubeconfig;
  const nowMs = options.nowMs || Date.now();
  const namespaces = options.namespaces || DEFAULT_NAMESPACES;

  const results = await Promise.all(
    namespaces.map(async (namespace) => {
      const result = await shell.runCapture('kubectl', [
        '--kubeconfig',
        kubeconfig,
        '-n',
        namespace,
        'get',
        'pods',
        '-o',
        'json',
      ]);
      return { namespace, ...result, json: result.ok ? parseJsonOutput(result.output) : null };
    }),
  );

  const pods = [];
  const errors = [];
  for (const result of results) {
    if (!result.ok) {
      errors.push(`namespace ${result.namespace}: ${result.output.trim() || 'kubectl get pods failed'}`);
      continue;
    }
    for (const item of result.json?.items || []) {
      pods.push(summarizePod(item, nowMs));
    }
  }

  pods.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));

  return {
    fetchedAt: new Date(nowMs).toISOString(),
    namespaces: [...namespaces],
    pods,
    errors,
  };
}

function parseLogLine(line) {
  const text = String(line || '');
  const match = text.match(/^(\S+)\s(.*)$/);
  if (match) {
    const stamp = Date.parse(match[1]);
    if (!Number.isNaN(stamp)) {
      return {
        timestamp: match[1],
        message: match[2],
        text,
      };
    }
  }
  return {
    timestamp: null,
    message: text,
    text,
  };
}

function splitLogLines(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseLogLine);
}

export async function readPodLogsTail(env, podRef, options = {}) {
  const shell = options.runner || new ShellRunner({ cwd: env.runtime.assetRoot });
  const kubeconfig = options.kubeconfig || env.paths.kubeconfig;
  const tailLines = Number(options.tailLines || 200);
  const args = ['--kubeconfig', kubeconfig, '-n', podRef.namespace, 'logs', podRef.name, '--timestamps', '--tail', String(Math.max(1, tailLines))];

  if (podRef.container) {
    args.push('-c', podRef.container);
  }

  if (options.previous) {
    args.push('--previous');
  }

  const result = await shell.runCapture('kubectl', args);
  return {
    ok: result.ok,
    code: result.code,
    lines: splitLogLines(result.output),
    error: result.ok ? null : result.output.trim() || 'kubectl logs failed',
  };
}

export async function readPodLogsSince(env, podRef, options = {}) {
  const shell = options.runner || new ShellRunner({ cwd: env.runtime.assetRoot });
  const kubeconfig = options.kubeconfig || env.paths.kubeconfig;
  const sinceTime = options.sinceTime;
  if (!sinceTime) {
    return { ok: true, code: 0, lines: [], error: null };
  }

  const args = ['--kubeconfig', kubeconfig, '-n', podRef.namespace, 'logs', podRef.name, '--timestamps', '--since-time', sinceTime];

  if (podRef.container) {
    args.push('-c', podRef.container);
  }

  if (options.previous) {
    args.push('--previous');
  }

  const result = await shell.runCapture('kubectl', args);
  return {
    ok: result.ok,
    code: result.code,
    lines: splitLogLines(result.output),
    error: result.ok ? null : result.output.trim() || 'kubectl logs failed',
  };
}

export { DEFAULT_NAMESPACES, formatDuration, parseLogLine, summarizePod };
