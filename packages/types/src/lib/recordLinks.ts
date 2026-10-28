/**
 * Canonical record links: the ONE mapping between a record and the app path that opens it.
 *
 * NO imports on purpose, and no URL / URLSearchParams globals: this file is copied verbatim to
 * ee/mobile/src/urls/recordLinks.ts (the mobile workspace does not consume @alga-psa/types) and a
 * parity test keeps the two byte-identical. It must run unchanged in Node, the browser and Hermes.
 *
 * The functions are pure and bidirectional: for every supported record,
 * `matchRecordPath(recordPath(type, id, opts))` returns `{ entityType: type, id, ...opts }`.
 *
 * Canonical routes (verified against server/src/app/msp on the commit this was written):
 *   ticket        /msp/tickets/{id}                      (UUIDs only, see TICKET_ID_PATTERN)
 *   asset         /msp/assets/{id}
 *   project       /msp/projects/{id}
 *   project_task  /msp/projects/{projectId}?taskId={id}  (ProjectPage reads ?taskId=; the legacy
 *                 /msp/projects/{projectId}/tasks/{id} route only redirects to this form and is
 *                 still ACCEPTED by matchRecordPath)
 *   stock_unit    /msp/inventory/units?unitId={id}       (no detail route; the list page does not
 *                 read unitId yet. C3 of alga-2026-0002683 adds the reader.)
 *   rma           /msp/inventory/rma?rmaId={id}          (no detail route; the list page reads
 *                 only ?status= today. C3 adds the reader.)
 *   staging_container
 *                 /msp/projects/{projectId}/staging?containerId={id}
 *                 (a project staging box, C6 of alga-2026-0002683; like project_task it is
 *                 addressed through its project, and the staging page opens the box)
 *
 * Link content is NOT a secret: no tokens, no tenant secrets. Authorization happens after the link
 * is opened, on the page the link lands on.
 */

export const RECORD_ENTITY_TYPES = [
  'ticket',
  'asset',
  'project',
  'project_task',
  'stock_unit',
  'rma',
  'staging_container',
] as const;

export type RecordEntityType = (typeof RECORD_ENTITY_TYPES)[number];

export interface RecordLinkOptions {
  /** Required for `project_task` and `staging_container`: both are addressed through their project. */
  projectId?: string;
  /** Optional for `project_task`: opens the board on this phase. */
  phaseId?: string;
}

export interface MatchedRecordPath {
  entityType: RecordEntityType;
  id: string;
  projectId?: string;
  phaseId?: string;
}

const requireId = (label: string, value: string | null | undefined): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`recordLinks: ${label} must be a non-empty string`);
  }
  return encodeURIComponent(value);
};

export function isRecordEntityType(value: unknown): value is RecordEntityType {
  return typeof value === 'string' && (RECORD_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Canonical app path (with query string where the canonical form has one) for a record. */
export function recordPath(
  entityType: RecordEntityType,
  id: string,
  options: RecordLinkOptions = {}
): string {
  const safeId = requireId(`${entityType} id`, id);
  switch (entityType) {
    case 'ticket':
      return `/msp/tickets/${safeId}`;
    case 'asset':
      return `/msp/assets/${safeId}`;
    case 'project':
      return `/msp/projects/${safeId}`;
    case 'project_task': {
      const projectId = requireId('project_task projectId', options.projectId);
      const phase = options.phaseId ? `&phaseId=${requireId('phaseId', options.phaseId)}` : '';
      return `/msp/projects/${projectId}?taskId=${safeId}${phase}`;
    }
    case 'stock_unit':
      return `/msp/inventory/units?unitId=${safeId}`;
    case 'rma':
      return `/msp/inventory/rma?rmaId=${safeId}`;
    case 'staging_container': {
      const projectId = requireId('staging_container projectId', options.projectId);
      return `/msp/projects/${projectId}/staging?containerId=${safeId}`;
    }
    default: {
      const exhaustive: never = entityType;
      throw new Error(`recordLinks: unsupported entity type ${String(exhaustive)}`);
    }
  }
}

/** Absolute URL for a record: `baseUrl` (http/https origin, trailing slashes tolerated) + path. */
export function recordUrl(
  entityType: RecordEntityType,
  id: string,
  baseUrl: string,
  options: RecordLinkOptions = {}
): string {
  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/?#\s]+/i.test(baseUrl.trim())) {
    throw new Error('recordLinks: baseUrl must be an absolute http(s) URL');
  }
  return `${baseUrl.trim().replace(/\/+$/, '')}${recordPath(entityType, id, options)}`;
}

const safeDecode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const parseQuery = (query: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq === -1 ? pair : pair.slice(0, eq));
    const value = safeDecode(eq === -1 ? '' : pair.slice(eq + 1));
    if (key !== null && value !== null && !(key in params)) {
      params[key] = value;
    }
  }
  return params;
};

/**
 * Inverse of `recordPath`. Accepts a path (`/msp/tickets/<id>`), optionally with a query string
 * and/or fragment, or an absolute http(s) URL (the origin is stripped; checking that the origin is
 * one you trust is the caller's job). Returns null for anything that is not a record link.
 */
export function matchRecordPath(input: string): MatchedRecordPath | null {
  if (typeof input !== 'string') return null;
  let rest = input.trim().replace(/^https?:\/\/[^/?#]+/i, '');
  const hashAt = rest.indexOf('#');
  if (hashAt !== -1) rest = rest.slice(0, hashAt);
  const queryAt = rest.indexOf('?');
  const pathname = (queryAt === -1 ? rest : rest.slice(0, queryAt)).replace(/\/+$/, '');
  const query = parseQuery(queryAt === -1 ? '' : rest.slice(queryAt + 1));

  const segments = pathname.split('/');
  // ['', 'msp', ...]
  if (segments[0] !== '' || segments[1] !== 'msp') return null;
  const decoded = segments.slice(2).map(safeDecode);
  if (decoded.some((segment) => segment === null || segment === '')) return null;
  const parts = decoded as string[];

  switch (parts[0]) {
    case 'tickets':
      return parts.length === 2 ? { entityType: 'ticket', id: parts[1] } : null;
    case 'assets':
      return parts.length === 2 ? { entityType: 'asset', id: parts[1] } : null;
    case 'projects': {
      if (parts.length === 2) {
        const taskId = query.taskId;
        if (taskId) {
          const matched: MatchedRecordPath = { entityType: 'project_task', id: taskId, projectId: parts[1] };
          if (query.phaseId) matched.phaseId = query.phaseId;
          return matched;
        }
        return { entityType: 'project', id: parts[1] };
      }
      if (parts.length === 3 && parts[2] === 'staging') {
        return query.containerId ? { entityType: 'staging_container', id: query.containerId, projectId: parts[1] } : null;
      }
      // Legacy form, still served by a redirect route.
      if (parts.length === 4 && parts[2] === 'tasks') {
        return { entityType: 'project_task', id: parts[3], projectId: parts[1] };
      }
      return null;
    }
    case 'inventory': {
      if (parts.length !== 2) return null;
      if (parts[1] === 'units' && query.unitId) return { entityType: 'stock_unit', id: query.unitId };
      if (parts[1] === 'rma' && query.rmaId) return { entityType: 'rma', id: query.rmaId };
      return null;
    }
    default:
      return null;
  }
}
