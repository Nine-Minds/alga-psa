import type { Envelope } from '../types';

export function applyAssignments(env: Envelope, assignments: Record<string, unknown>): Envelope {
  const next = {
    ...env,
    payload: cloneJson(env.payload),
    vars: cloneJson(env.vars),
    meta: cloneJson(env.meta)
  } as Envelope;

  for (const [path, value] of Object.entries(assignments)) {
    if (path.startsWith('payload.')) {
      setByPath(next.payload as Record<string, unknown>, path.replace(/^payload\./, ''), value);
      continue;
    }
    if (path.startsWith('vars.')) {
      setByPath(next.vars as Record<string, unknown>, path.replace(/^vars\./, ''), value);
      continue;
    }
    if (path.startsWith('meta.')) {
      setByPath(next.meta as Record<string, unknown>, path.replace(/^meta\./, ''), value);
      continue;
    }
    if (path.startsWith('error.')) {
      if (!next.error) {
        next.error = { message: '', at: new Date().toISOString() };
      }
      setByPath(next.error as Record<string, unknown>, path.replace(/^error\./, ''), value);
      continue;
    }
    if (path.startsWith('/')) {
      setByPointer(next.payload as Record<string, unknown>, path, value);
      continue;
    }

    // Default to payload
    setByPath(next.payload as Record<string, unknown>, path, value);
  }

  return next;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    if (i === parts.length - 1) {
      cursor[key] = value;
      return;
    }
    if (typeof cursor[key] !== 'object' || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
}

function setByPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const parts = pointer
    .replace(/^\//, '')
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .filter(Boolean);
  setByPath(target, parts.join('.'), value);
}
