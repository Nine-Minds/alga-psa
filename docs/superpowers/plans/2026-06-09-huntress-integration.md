# Huntress Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Huntress SOC incident reports automatically become routed, self-contained Alga tickets via a polling engine, with fail-safe org→client mapping.

**Architecture:** EE-only integration reusing the `rmm_*` tables with `provider='huntress'`. A pg-boss dispatcher job ticks every 5 minutes, polls the Huntress REST API (Basic auth, cursor-walk over `updated_at`-sorted incident reports), upserts `rmm_alerts`, and creates/updates tickets per a pure decision planner. Spec: `docs/superpowers/specs/2026-06-09-huntress-integration-design.md`.

**Tech Stack:** Next.js server actions, Knex, axios, pg-boss (`JobScheduler`), Vitest, `@alga-psa/ui` components.

**Working rules for every task:**
- All commands run from the repo root unless stated otherwise.
- Commit after each task with the message given in the task.
- Set git author if needed: `git -c user.email="robert@nineminds.com" -c user.name="Robert Isaacs" commit ...`
- The integration test task requires the dev Postgres running (the worktree's Docker dev stack; `DB_PORT` defaults to 5432).

---

## File Structure

**New files (EE logic):**

| File | Responsibility |
| --- | --- |
| `ee/server/src/interfaces/huntress.interfaces.ts` | Huntress API response types |
| `ee/server/src/lib/integrations/huntress/settings.ts` | `HuntressSettings` parse/validate/prefill + poll-due check (pure) |
| `ee/server/src/lib/integrations/huntress/organizations/nameMatch.ts` | Org-name normalization + exact-match (pure) |
| `ee/server/src/lib/integrations/huntress/huntressClient.ts` | REST client: Basic auth, throttle, 429 retry, pagination |
| `ee/server/src/lib/integrations/huntress/incidents/cursorWalk.ts` | Cursor-bounded page collection (pure, takes a fetch-page fn) |
| `ee/server/src/lib/integrations/huntress/incidents/ticketContent.ts` | Title/body/note/portal-link builders (pure) |
| `ee/server/src/lib/integrations/huntress/incidents/incidentPlan.ts` | Pure lifecycle decision: create/fallback/note/close/record/skip |
| `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts` | Transactional ticket + thread/comment inserts |
| `ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts` | Executes a plan against the DB for one incident |
| `ee/server/src/lib/integrations/huntress/incidents/incidentPoller.ts` | Per-integration poll cycle, cursor persistence, transport wrapper |
| `ee/server/src/lib/integrations/huntress/organizations/orgSync.ts` | Org fetch → mapping upsert + auto-match |
| `ee/server/src/lib/integrations/huntress/scheduling.ts` | pg-boss dispatcher registration + per-integration due-check |
| `ee/server/src/lib/integrations/huntress/index.ts` | Public exports |
| `ee/server/src/lib/actions/integrations/huntressActions.ts` | Server actions (connect, status, settings, mappings, poll-now) |

**New files (UI + CE stubs):**

| File | Responsibility |
| --- | --- |
| `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx` | Connect card, status, routing config |
| `ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx` | Org→client mapping table |
| `packages/ee/src/components/settings/integrations/HuntressIntegrationSettings.tsx` | CE stub ("Enterprise feature") |
| `packages/ee/src/lib/integrations/huntress/scheduling.ts` | CE no-op stub for job registration |

**Modified files:**

| File | Change |
| --- | --- |
| `packages/types/src/interfaces/asset.interfaces.ts:24` | add `'huntress'` to `RmmProvider` |
| `ee/server/src/interfaces/rmm.interfaces.ts:9` | add `'huntress'` to `RmmProvider` |
| `packages/integrations/src/lib/rmm/providerRegistry.ts` | `category` field + huntress entry |
| `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx` | category sections + huntress dynamic import |
| `server/src/lib/initializeApp.ts` | EE-gated registration of the Huntress poll dispatcher |

**Tests:**

| File | Covers |
| --- | --- |
| `ee/server/src/__tests__/unit/huntress/settings.test.ts` | parse/validate/prefill/poll-due |
| `ee/server/src/__tests__/unit/huntress/nameMatch.test.ts` | normalization + exact match |
| `ee/server/src/__tests__/unit/huntress/cursorWalk.test.ts` | pagination, cursor boundary, backfill, ordering |
| `ee/server/src/__tests__/unit/huntress/ticketContent.test.ts` | title/body/note/link builders |
| `ee/server/src/__tests__/unit/huntress/incidentPlan.test.ts` | every lifecycle decision |
| `ee/server/src/__tests__/unit/huntress/huntressClient.test.ts` | auth header, throttle, 429 retry, pagination, 404→null |
| `ee/server/src/__tests__/unit/huntress/incidentPoller.test.ts` | cursor advance, stop-on-failure, sync status |
| `ee/server/src/__tests__/integration/huntressIncidentProcessor.integration.test.ts` | DB end-to-end: create/dedup/note/close/fallback |
| `ee/server/src/__tests__/integration/huntressOrgSync.integration.test.ts` | DB: mapping upsert + auto-match |

---

### Task 1: Provider type + Huntress API interfaces

**Files:**
- Modify: `packages/types/src/interfaces/asset.interfaces.ts:24`
- Modify: `ee/server/src/interfaces/rmm.interfaces.ts:9`
- Create: `ee/server/src/interfaces/huntress.interfaces.ts`

- [ ] **Step 1: Add `'huntress'` to both `RmmProvider` types**

In `packages/types/src/interfaces/asset.interfaces.ts` line 24, change:

```typescript
export type RmmProvider = 'ninjaone' | 'tacticalrmm' | 'tanium' | 'datto' | 'connectwise_automate';
```

to:

```typescript
export type RmmProvider = 'ninjaone' | 'tacticalrmm' | 'tanium' | 'datto' | 'connectwise_automate' | 'huntress';
```

In `ee/server/src/interfaces/rmm.interfaces.ts` line 9, make the same change (the type is duplicated there).

- [ ] **Step 2: Create `ee/server/src/interfaces/huntress.interfaces.ts`**

```typescript
/**
 * Huntress public API types.
 *
 * Shapes follow the Huntress OpenAPI spec (api.huntress.io). List endpoints
 * wrap results: { incident_reports: [...], pagination: { next_page_token } }.
 */

export type HuntressSeverity = 'low' | 'high' | 'critical';

export type HuntressIncidentStatus =
  | 'sent'
  | 'closed'
  | 'dismissed'
  | 'auto_remediating'
  | 'deleting'
  | 'partner_dismissed';

export interface HuntressRemediationParameter {
  name: string;
  description: string;
}

export interface HuntressRemediation {
  id: number;
  type: string;
  action?: string;
  status?: string;
  parameters?: HuntressRemediationParameter[];
  approved_at?: string | null;
  completed_at?: string | null;
}

export interface HuntressIncidentReport {
  id: number;
  account_id: number;
  agent_id: number | null;
  organization_id: number | null;
  subject: string | null;
  summary: string | null;
  body: string | null;
  severity: HuntressSeverity;
  status: HuntressIncidentStatus;
  platform: string | null;
  indicator_types: string[];
  indicator_counts: Record<string, number>;
  remediations?: {
    total_count: number;
    has_more: boolean;
    items: HuntressRemediation[];
  };
  sent_at: string | null;
  closed_at: string | null;
  status_updated_at: string | null;
  updated_at: string;
}

export interface HuntressOrganization {
  id: number;
  name: string;
  key?: string;
}

export interface HuntressAgent {
  id: number;
  hostname: string | null;
  platform?: string | null;
  os?: string | null;
  ipv4_address?: string | null;
  external_ip?: string | null;
  serial_number?: string | null;
  last_callback_at?: string | null;
}

export interface HuntressAccount {
  id: number;
  name: string;
  subdomain: string;
}

export interface HuntressPagination {
  next_page_token?: string | null;
  next_page_url?: string | null;
}

export interface HuntressIncidentReportsPage {
  incident_reports: HuntressIncidentReport[];
  pagination?: HuntressPagination;
}

export interface HuntressOrganizationsPage {
  organizations: HuntressOrganization[];
  pagination?: HuntressPagination;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ee/server && npm run typecheck`
Expected: same result as before the change (no new errors; pre-existing errors, if any, are unrelated).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/interfaces/asset.interfaces.ts ee/server/src/interfaces/rmm.interfaces.ts ee/server/src/interfaces/huntress.interfaces.ts
git commit -m "feat(huntress): add provider type and Huntress API interfaces"
```

---

### Task 2: Settings parsing, validation, prefill, poll-due (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/settings.ts`
- Test: `ee/server/src/__tests__/unit/huntress/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/settings.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  parseHuntressSettings,
  isRoutingConfigComplete,
  prefillSeverityPriorityMap,
  isPollDue,
} from '@ee/lib/integrations/huntress/settings';

describe('parseHuntressSettings', () => {
  it('applies defaults to an empty object', () => {
    const s = parseHuntressSettings({});
    expect(s.pollIntervalMinutes).toBe(5);
    expect(s.backfillDays).toBe(7);
    expect(s.autoCloseTickets).toBe(false);
    expect(s.severityPriorityMap).toEqual({});
    expect(s.incidentCursor).toBeUndefined();
  });

  it('accepts a JSON string (jsonb may arrive serialized)', () => {
    const s = parseHuntressSettings(JSON.stringify({ pollIntervalMinutes: 10 }));
    expect(s.pollIntervalMinutes).toBe(10);
  });

  it('tolerates null/undefined/garbage', () => {
    expect(parseHuntressSettings(null).pollIntervalMinutes).toBe(5);
    expect(parseHuntressSettings(undefined).backfillDays).toBe(7);
    expect(parseHuntressSettings('not json').autoCloseTickets).toBe(false);
  });

  it('clamps pollIntervalMinutes to [1, 60] and backfillDays to [1, 30]', () => {
    expect(parseHuntressSettings({ pollIntervalMinutes: 0 }).pollIntervalMinutes).toBe(1);
    expect(parseHuntressSettings({ pollIntervalMinutes: 999 }).pollIntervalMinutes).toBe(60);
    expect(parseHuntressSettings({ backfillDays: 0 }).backfillDays).toBe(1);
    expect(parseHuntressSettings({ backfillDays: 90 }).backfillDays).toBe(30);
  });

  it('preserves configured routing fields', () => {
    const s = parseHuntressSettings({
      boardId: 'b1',
      fallbackClientId: 'c1',
      fallbackBoardId: 'b2',
      severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
      autoCloseTickets: true,
      closedStatusId: 's1',
      accountSubdomain: 'acme',
      incidentCursor: '2026-06-01T00:00:00Z',
    });
    expect(s.boardId).toBe('b1');
    expect(s.fallbackClientId).toBe('c1');
    expect(s.fallbackBoardId).toBe('b2');
    expect(s.severityPriorityMap.critical).toBe('p1');
    expect(s.autoCloseTickets).toBe(true);
    expect(s.closedStatusId).toBe('s1');
    expect(s.accountSubdomain).toBe('acme');
    expect(s.incidentCursor).toBe('2026-06-01T00:00:00Z');
  });
});

describe('isRoutingConfigComplete', () => {
  const complete = parseHuntressSettings({
    boardId: 'b1',
    fallbackClientId: 'c1',
    fallbackBoardId: 'b2',
    severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
  });

  it('true when board, fallback client/board, and all three severities are set', () => {
    expect(isRoutingConfigComplete(complete)).toBe(true);
  });

  it('false when any required piece is missing', () => {
    expect(isRoutingConfigComplete({ ...complete, boardId: undefined })).toBe(false);
    expect(isRoutingConfigComplete({ ...complete, fallbackClientId: undefined })).toBe(false);
    expect(isRoutingConfigComplete({ ...complete, fallbackBoardId: undefined })).toBe(false);
    expect(
      isRoutingConfigComplete({ ...complete, severityPriorityMap: { critical: 'p1', high: 'p2' } })
    ).toBe(false);
  });
});

describe('prefillSeverityPriorityMap', () => {
  it('matches by name, case-insensitively, with preference order', () => {
    const priorities = [
      { priority_id: 'p-med', priority_name: 'Medium' },
      { priority_id: 'p-high', priority_name: 'HIGH' },
      { priority_id: 'p-crit', priority_name: 'Critical' },
    ];
    const map = prefillSeverityPriorityMap(priorities);
    expect(map).toEqual({ critical: 'p-crit', high: 'p-high', low: 'p-med' });
  });

  it('prefers Urgent for critical when Critical is absent', () => {
    const map = prefillSeverityPriorityMap([
      { priority_id: 'p-urg', priority_name: 'Urgent' },
    ]);
    expect(map.critical).toBe('p-urg');
  });

  it('leaves severities unset when nothing matches', () => {
    const map = prefillSeverityPriorityMap([{ priority_id: 'x', priority_name: 'Weird' }]);
    expect(map).toEqual({});
  });
});

describe('isPollDue', () => {
  const now = new Date('2026-06-09T12:00:00Z');

  it('true when never synced', () => {
    expect(isPollDue(null, 5, now)).toBe(true);
    expect(isPollDue(undefined, 5, now)).toBe(true);
  });

  it('true when the interval has elapsed', () => {
    expect(isPollDue('2026-06-09T11:54:59Z', 5, now)).toBe(true);
  });

  it('false when within the interval', () => {
    expect(isPollDue('2026-06-09T11:58:00Z', 5, now)).toBe(false);
  });

  it('accepts Date input for lastSyncAt', () => {
    expect(isPollDue(new Date('2026-06-09T11:00:00Z'), 5, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/settings.test.ts`
Expected: FAIL — cannot resolve `@ee/lib/integrations/huntress/settings`.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/settings.ts`:

```typescript
/**
 * Huntress integration settings stored in rmm_integrations.settings (JSONB).
 * Pure parsing/validation helpers — no I/O.
 */

export interface HuntressSeverityPriorityMap {
  critical?: string;
  high?: string;
  low?: string;
}

export interface HuntressSettings {
  accountName?: string;
  accountSubdomain?: string;
  /** Max incident updated_at fully processed (ISO-8601). */
  incidentCursor?: string;
  pollIntervalMinutes: number;
  backfillDays: number;
  severityPriorityMap: HuntressSeverityPriorityMap;
  boardId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  fallbackClientId?: string;
  fallbackBoardId?: string;
  autoCloseTickets: boolean;
  closedStatusId?: string | null;
}

const DEFAULT_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_BACKFILL_DAYS = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseHuntressSettings(raw: unknown): HuntressSettings {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      // fall through to defaults
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }

  const rawMap = (obj.severityPriorityMap ?? {}) as Record<string, unknown>;
  const severityPriorityMap: HuntressSeverityPriorityMap = {};
  if (asString(rawMap.critical)) severityPriorityMap.critical = rawMap.critical as string;
  if (asString(rawMap.high)) severityPriorityMap.high = rawMap.high as string;
  if (asString(rawMap.low)) severityPriorityMap.low = rawMap.low as string;

  const pollInterval = Number(obj.pollIntervalMinutes);
  const backfill = Number(obj.backfillDays);

  return {
    accountName: asString(obj.accountName),
    accountSubdomain: asString(obj.accountSubdomain),
    incidentCursor: asString(obj.incidentCursor),
    pollIntervalMinutes: Number.isFinite(pollInterval)
      ? clamp(pollInterval, 1, 60)
      : DEFAULT_POLL_INTERVAL_MINUTES,
    backfillDays: Number.isFinite(backfill) ? clamp(backfill, 1, 30) : DEFAULT_BACKFILL_DAYS,
    severityPriorityMap,
    boardId: asString(obj.boardId),
    categoryId: asString(obj.categoryId) ?? null,
    subcategoryId: asString(obj.subcategoryId) ?? null,
    fallbackClientId: asString(obj.fallbackClientId),
    fallbackBoardId: asString(obj.fallbackBoardId),
    autoCloseTickets: obj.autoCloseTickets === true,
    closedStatusId: asString(obj.closedStatusId) ?? null,
  };
}

export function isRoutingConfigComplete(settings: HuntressSettings): boolean {
  return Boolean(
    settings.boardId &&
      settings.fallbackClientId &&
      settings.fallbackBoardId &&
      settings.severityPriorityMap.critical &&
      settings.severityPriorityMap.high &&
      settings.severityPriorityMap.low
  );
}

/** Name preference order per Huntress severity, lowercased. */
const SEVERITY_NAME_PREFERENCES: Record<keyof HuntressSeverityPriorityMap, string[]> = {
  critical: ['critical', 'urgent'],
  high: ['high'],
  low: ['medium', 'low'],
};

export function prefillSeverityPriorityMap(
  priorities: Array<{ priority_id: string; priority_name: string }>
): HuntressSeverityPriorityMap {
  const byName = new Map<string, string>();
  for (const p of priorities) {
    const key = p.priority_name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, p.priority_id);
  }

  const map: HuntressSeverityPriorityMap = {};
  for (const severity of Object.keys(SEVERITY_NAME_PREFERENCES) as Array<
    keyof HuntressSeverityPriorityMap
  >) {
    for (const name of SEVERITY_NAME_PREFERENCES[severity]) {
      const id = byName.get(name);
      if (id) {
        map[severity] = id;
        break;
      }
    }
  }
  return map;
}

export function isPollDue(
  lastSyncAt: string | Date | null | undefined,
  intervalMinutes: number,
  now: Date
): boolean {
  if (!lastSyncAt) return true;
  const last = lastSyncAt instanceof Date ? lastSyncAt.getTime() : Date.parse(lastSyncAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= intervalMinutes * 60_000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/settings.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/settings.ts ee/server/src/__tests__/unit/huntress/settings.test.ts
git commit -m "feat(huntress): settings parsing, routing validation, priority prefill"
```

---

### Task 3: Org name matching (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/organizations/nameMatch.ts`
- Test: `ee/server/src/__tests__/unit/huntress/nameMatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/nameMatch.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  normalizeOrgName,
  findExactNameMatch,
} from '@ee/lib/integrations/huntress/organizations/nameMatch';

describe('normalizeOrgName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeOrgName('  Acme,  Inc.  ')).toBe('acme inc');
    expect(normalizeOrgName('ACME-INC')).toBe('acme inc');
    expect(normalizeOrgName("O'Brien & Sons LLC")).toBe('obrien sons llc');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeOrgName('')).toBe('');
    expect(normalizeOrgName('   ')).toBe('');
  });
});

describe('findExactNameMatch', () => {
  const clients = [
    { client_id: 'c1', client_name: 'Acme, Inc.' },
    { client_id: 'c2', client_name: 'Globex' },
    { client_id: 'c3', client_name: 'globex' },
  ];

  it('returns the client_id on a unique normalized match', () => {
    expect(findExactNameMatch('ACME INC', clients)).toBe('c1');
  });

  it('returns null when no client matches', () => {
    expect(findExactNameMatch('Initech', clients)).toBeNull();
  });

  it('returns null when the match is ambiguous (two clients normalize identically)', () => {
    expect(findExactNameMatch('Globex', clients)).toBeNull();
  });

  it('returns null for empty org names', () => {
    expect(findExactNameMatch('', clients)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/nameMatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/organizations/nameMatch.ts`:

```typescript
/**
 * Exact-name auto-matching between Huntress organizations and Alga clients.
 * Only unambiguous, exact normalized matches auto-link; anything weaker is
 * left for the user to map manually.
 */

export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findExactNameMatch(
  orgName: string,
  clients: Array<{ client_id: string; client_name: string }>
): string | null {
  const target = normalizeOrgName(orgName);
  if (!target) return null;

  const matches = clients.filter((c) => normalizeOrgName(c.client_name) === target);
  return matches.length === 1 ? matches[0].client_id : null;
}
```

Note: `'ACME-INC'` normalizes to `'acme inc'` because punctuation becomes a space before whitespace collapses.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/nameMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/organizations/nameMatch.ts ee/server/src/__tests__/unit/huntress/nameMatch.test.ts
git commit -m "feat(huntress): org name normalization and exact auto-match"
```

---

### Task 4: Cursor walker (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/incidents/cursorWalk.ts`
- Test: `ee/server/src/__tests__/unit/huntress/cursorWalk.test.ts`

The Huntress list API has no "updated since" filter; we sort by `updated_at desc` and walk pages until rows are older than the boundary (cursor minus overlap, or the backfill window on first run).

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/cursorWalk.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { collectIncidentsSince } from '@ee/lib/integrations/huntress/incidents/cursorWalk';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';

function incident(id: number, updatedAt: string): HuntressIncidentReport {
  return {
    id,
    account_id: 1,
    agent_id: null,
    organization_id: 1,
    subject: `Incident ${id}`,
    summary: null,
    body: null,
    severity: 'low',
    status: 'sent',
    platform: null,
    indicator_types: [],
    indicator_counts: {},
    sent_at: updatedAt,
    closed_at: null,
    status_updated_at: null,
    updated_at: updatedAt,
  };
}

/** fetchPage stub serving fixed pages keyed by token (undefined = first page). */
function pagesFetcher(pages: Record<string, { incidents: HuntressIncidentReport[]; nextPageToken?: string }>) {
  return vi.fn(async (pageToken?: string) => pages[pageToken ?? 'first']);
}

const NOW = new Date('2026-06-09T12:00:00Z');

describe('collectIncidentsSince', () => {
  it('collects incidents newer than the cursor (minus overlap) and returns ascending', async () => {
    const fetchPage = pagesFetcher({
      first: {
        incidents: [
          incident(3, '2026-06-09T11:00:00Z'),
          incident(2, '2026-06-09T10:00:00Z'),
          incident(1, '2026-06-08T10:00:00Z'), // older than cursor → boundary hit
        ],
      },
    });

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: '2026-06-09T09:00:00Z',
      backfillDays: 7,
      now: NOW,
    });

    expect(result.map((i) => i.id)).toEqual([2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('includes incidents inside the overlap window (cursor minus 60s) for dedup-safe reprocessing', async () => {
    const fetchPage = pagesFetcher({
      first: {
        incidents: [incident(2, '2026-06-09T08:59:30Z'), incident(1, '2026-06-09T08:00:00Z')],
      },
    });

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: '2026-06-09T09:00:00Z',
      backfillDays: 7,
      now: NOW,
    });

    // 08:59:30 is within the 60s overlap of the 09:00 cursor.
    expect(result.map((i) => i.id)).toEqual([2]);
  });

  it('walks multiple pages until the boundary', async () => {
    const fetchPage = pagesFetcher({
      first: {
        incidents: [incident(4, '2026-06-09T11:00:00Z'), incident(3, '2026-06-09T10:30:00Z')],
        nextPageToken: 'p2',
      },
      p2: {
        incidents: [incident(2, '2026-06-09T10:00:00Z'), incident(1, '2026-06-01T00:00:00Z')],
      },
    });

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: '2026-06-09T09:00:00Z',
      backfillDays: 7,
      now: NOW,
    });

    expect(result.map((i) => i.id)).toEqual([2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops paging when there is no next token even if all rows qualified', async () => {
    const fetchPage = pagesFetcher({
      first: { incidents: [incident(1, '2026-06-09T11:00:00Z')] },
    });

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: '2026-06-09T09:00:00Z',
      backfillDays: 7,
      now: NOW,
    });

    expect(result.map((i) => i.id)).toEqual([1]);
  });

  it('uses now - backfillDays as the boundary when there is no cursor', async () => {
    const fetchPage = pagesFetcher({
      first: {
        incidents: [
          incident(2, '2026-06-08T12:00:00Z'), // 1 day old → in window
          incident(1, '2026-05-01T00:00:00Z'), // far older → out
        ],
      },
    });

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: null,
      backfillDays: 7,
      now: NOW,
    });

    expect(result.map((i) => i.id)).toEqual([2]);
  });

  it('respects maxPages as a runaway guard', async () => {
    const fetchPage = vi.fn(async (token?: string) => ({
      incidents: [incident(Number(token ?? 1), '2026-06-09T11:00:00Z')],
      nextPageToken: String(Number(token ?? 1) + 1),
    }));

    const result = await collectIncidentsSince(fetchPage, {
      cursorIso: '2026-06-09T09:00:00Z',
      backfillDays: 7,
      now: NOW,
      maxPages: 3,
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/cursorWalk.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/incidents/cursorWalk.ts`:

```typescript
/**
 * Cursor-bounded collection of Huntress incident reports.
 *
 * The Huntress API cannot filter by "updated since"; callers fetch pages
 * sorted by updated_at DESC and this walker stops once rows fall behind the
 * boundary (cursor minus a small overlap, or the backfill window on first
 * run). Reprocessing inside the overlap is harmless — the processor dedups
 * on external_alert_id.
 */

import type { HuntressIncidentReport } from '../../../../interfaces/huntress.interfaces';

export interface CursorWalkPage {
  incidents: HuntressIncidentReport[];
  nextPageToken?: string;
}

export type FetchIncidentsPage = (pageToken?: string) => Promise<CursorWalkPage>;

export interface CursorWalkOptions {
  /** Last fully processed updated_at (ISO-8601), or null on first run. */
  cursorIso: string | null;
  backfillDays: number;
  /** Injection point for tests; defaults to the current time. */
  now?: Date;
  overlapMs?: number;
  maxPages?: number;
}

const DEFAULT_OVERLAP_MS = 60_000;
const DEFAULT_MAX_PAGES = 20;

export async function collectIncidentsSince(
  fetchPage: FetchIncidentsPage,
  options: CursorWalkOptions
): Promise<HuntressIncidentReport[]> {
  const now = options.now ?? new Date();
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const boundaryMs = options.cursorIso
    ? Date.parse(options.cursorIso) - overlapMs
    : now.getTime() - options.backfillDays * 24 * 60 * 60 * 1000;

  const collected: HuntressIncidentReport[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(pageToken);
    let hitBoundary = false;

    for (const item of result.incidents) {
      const updatedMs = Date.parse(item.updated_at);
      if (Number.isFinite(updatedMs) && updatedMs >= boundaryMs) {
        collected.push(item);
      } else {
        hitBoundary = true;
        break;
      }
    }

    if (hitBoundary || !result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }

  return collected.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/cursorWalk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/incidents/cursorWalk.ts ee/server/src/__tests__/unit/huntress/cursorWalk.test.ts
git commit -m "feat(huntress): cursor-bounded incident page walker"
```

---

### Task 5: Ticket content builders (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/incidents/ticketContent.ts`
- Test: `ee/server/src/__tests__/unit/huntress/ticketContent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/ticketContent.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildPortalUrl,
  buildTicketTitle,
  buildTicketBody,
  buildCreationNote,
  buildUpdateNote,
} from '@ee/lib/integrations/huntress/incidents/ticketContent';
import type {
  HuntressAgent,
  HuntressIncidentReport,
} from '@ee/interfaces/huntress.interfaces';

const incident: HuntressIncidentReport = {
  id: 42,
  account_id: 1,
  agent_id: 7,
  organization_id: 9,
  subject: 'CRITICAL - Incident on SRV01 (Acme)',
  summary: 'Huntress detected a malicious scheduled task.',
  body: null,
  severity: 'critical',
  status: 'sent',
  platform: 'windows',
  indicator_types: ['footholds', 'process_detections'],
  indicator_counts: { footholds: 1, process_detections: 2 },
  remediations: {
    total_count: 1,
    has_more: false,
    items: [
      {
        id: 1,
        type: 'manual',
        action: 'Delete File',
        status: 'pending',
        parameters: [{ name: 'path', description: 'c:\\bad\\task' }],
      },
    ],
  },
  sent_at: '2026-06-09T10:00:00Z',
  closed_at: null,
  status_updated_at: '2026-06-09T10:00:00Z',
  updated_at: '2026-06-09T10:00:00Z',
};

const agent: HuntressAgent = {
  id: 7,
  hostname: 'SRV01',
  os: 'Windows Server 2022',
  ipv4_address: '10.0.0.5',
  external_ip: '203.0.113.9',
  serial_number: 'SN-123',
  last_callback_at: '2026-06-09T09:55:00Z',
};

describe('buildPortalUrl', () => {
  it('uses the account subdomain when known', () => {
    expect(buildPortalUrl('acme', 42)).toBe('https://acme.huntress.io/incident_reports/42');
  });

  it('falls back to the bare portal domain without a subdomain', () => {
    expect(buildPortalUrl(undefined, 42)).toBe('https://huntress.io/incident_reports/42');
  });
});

describe('buildTicketTitle', () => {
  it('prefixes the Huntress subject', () => {
    expect(buildTicketTitle(incident, { unmapped: false })).toBe(
      '[Huntress] CRITICAL - Incident on SRV01 (Acme)'
    );
  });

  it('adds an unmapped-org marker', () => {
    expect(buildTicketTitle(incident, { unmapped: true })).toBe(
      '[Huntress] [Unmapped Org] CRITICAL - Incident on SRV01 (Acme)'
    );
  });

  it('synthesizes a title when subject is missing', () => {
    expect(buildTicketTitle({ ...incident, subject: null }, { unmapped: false })).toBe(
      '[Huntress] critical incident #42'
    );
  });
});

describe('buildTicketBody', () => {
  const url = buildPortalUrl('acme', incident.id);

  it('contains severity, summary, indicators, host details, remediations, and the portal link', () => {
    const body = buildTicketBody(incident, agent, url, { unmapped: false });
    expect(body).toContain('**Severity:** critical');
    expect(body).toContain('Huntress detected a malicious scheduled task.');
    expect(body).toContain('footholds (1)');
    expect(body).toContain('process_detections (2)');
    expect(body).toContain('**Hostname:** SRV01');
    expect(body).toContain('**Internal IP:** 10.0.0.5');
    expect(body).toContain('Delete File');
    expect(body).toContain('c:\\bad\\task');
    expect(body).toContain('https://acme.huntress.io/incident_reports/42');
  });

  it('shows the organization section instead of host when no agent (e.g. M365 incidents)', () => {
    const body = buildTicketBody(incident, null, url, { unmapped: false, orgName: 'Acme' });
    expect(body).not.toContain('**Hostname:**');
    expect(body).toContain('**Huntress Organization:** Acme');
  });

  it('prepends an unmapped-org warning when unmapped', () => {
    const body = buildTicketBody(incident, agent, url, { unmapped: true, orgName: 'Acme' });
    expect(body).toContain('not mapped to a client');
    expect(body).toContain('Acme');
  });
});

describe('buildCreationNote', () => {
  it('records the raw incident identifiers', () => {
    const note = buildCreationNote(incident);
    expect(note).toContain('Incident ID: 42');
    expect(note).toContain('Severity: critical');
    expect(note).toContain('Status: sent');
  });
});

describe('buildUpdateNote', () => {
  it('describes a status transition', () => {
    const note = buildUpdateNote('sent', { ...incident, status: 'closed' });
    expect(note).toContain('sent');
    expect(note).toContain('closed');
  });

  it('still produces a note when only updated_at changed', () => {
    const note = buildUpdateNote('sent', incident);
    expect(note).toContain('updated');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/ticketContent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/incidents/ticketContent.ts`:

```typescript
/**
 * Self-contained ticket content for Huntress incidents: a tech should be able
 * to triage from the ticket without opening the Huntress portal.
 */

import type {
  HuntressAgent,
  HuntressIncidentReport,
} from '../../../../interfaces/huntress.interfaces';

/**
 * Portal deep link. The path is the standard incident-report route; the exact
 * path is confirmed against a live account during smoke testing — keep all
 * URL construction in this one function.
 */
export function buildPortalUrl(subdomain: string | undefined, incidentId: number): string {
  const host = subdomain ? `${subdomain}.huntress.io` : 'huntress.io';
  return `https://${host}/incident_reports/${incidentId}`;
}

export interface TicketTitleOptions {
  unmapped: boolean;
}

export function buildTicketTitle(
  incident: HuntressIncidentReport,
  options: TicketTitleOptions
): string {
  const prefix = options.unmapped ? '[Huntress] [Unmapped Org]' : '[Huntress]';
  const subject = incident.subject || `${incident.severity} incident #${incident.id}`;
  return `${prefix} ${subject}`;
}

export interface TicketBodyOptions {
  unmapped: boolean;
  orgName?: string;
}

export function buildTicketBody(
  incident: HuntressIncidentReport,
  agent: HuntressAgent | null,
  portalUrl: string,
  options: TicketBodyOptions
): string {
  const lines: string[] = [];

  if (options.unmapped) {
    lines.push('> **Unmapped organization.** The Huntress organization');
    lines.push(
      `> "${options.orgName ?? incident.organization_id ?? 'unknown'}" is not mapped to a client.`
    );
    lines.push('> Map it in Settings → Integrations → Huntress, then move this ticket.');
    lines.push('');
  }

  lines.push('## Security Incident');
  lines.push('');
  lines.push(`**Severity:** ${incident.severity}`);
  lines.push(`**Status:** ${incident.status}`);
  if (incident.platform) lines.push(`**Platform:** ${incident.platform}`);
  const indicators = incident.indicator_types
    .map((t) => `${t} (${incident.indicator_counts?.[t] ?? '?'})`)
    .join(', ');
  if (indicators) lines.push(`**Indicators:** ${indicators}`);
  if (incident.sent_at) lines.push(`**Reported:** ${incident.sent_at}`);
  lines.push('');

  if (incident.summary) {
    lines.push('## SOC Summary');
    lines.push('');
    lines.push(incident.summary);
    lines.push('');
  }

  if (agent) {
    lines.push('## Affected Host');
    lines.push('');
    if (agent.hostname) lines.push(`**Hostname:** ${agent.hostname}`);
    if (agent.os) lines.push(`**OS:** ${agent.os}`);
    if (agent.ipv4_address) lines.push(`**Internal IP:** ${agent.ipv4_address}`);
    if (agent.external_ip) lines.push(`**External IP:** ${agent.external_ip}`);
    if (agent.serial_number) lines.push(`**Serial Number:** ${agent.serial_number}`);
    if (agent.last_callback_at) lines.push(`**Last Callback:** ${agent.last_callback_at}`);
    lines.push('');
  } else {
    lines.push('## Organization');
    lines.push('');
    lines.push(
      `**Huntress Organization:** ${options.orgName ?? incident.organization_id ?? 'unknown'}`
    );
    lines.push('');
  }

  const remediations = incident.remediations?.items ?? [];
  if (remediations.length > 0) {
    lines.push('## Remediations');
    lines.push('');
    for (const r of remediations) {
      const params = (r.parameters ?? []).map((p) => p.description).join(', ');
      lines.push(`- [${r.status ?? 'unknown'}] ${r.action ?? r.type}${params ? `: ${params}` : ''}`);
    }
    if (incident.remediations?.has_more) {
      lines.push(`- …and more (${incident.remediations.total_count} total — see portal)`);
    }
    lines.push('');
  }

  lines.push('## Links');
  lines.push('');
  lines.push(`[View in Huntress portal](${portalUrl})`);
  lines.push('');
  lines.push('---');
  lines.push('*This ticket was automatically created from a Huntress incident report.*');

  return lines.join('\n');
}

export function buildCreationNote(incident: HuntressIncidentReport): string {
  return [
    '**Ticket created automatically from a Huntress incident report**',
    '',
    `Incident ID: ${incident.id}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Updated: ${incident.updated_at}`,
  ].join('\n');
}

export function buildUpdateNote(
  previousStatus: string,
  incident: HuntressIncidentReport
): string {
  const lines = ['**Huntress incident updated**', ''];
  if (previousStatus !== incident.status) {
    lines.push(`Status: ${previousStatus} → ${incident.status}`);
  } else {
    lines.push(`Incident updated in Huntress (status remains ${incident.status}).`);
  }
  lines.push(`Updated: ${incident.updated_at}`);
  if (incident.closed_at) lines.push(`Closed at: ${incident.closed_at}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/ticketContent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/incidents/ticketContent.ts ee/server/src/__tests__/unit/huntress/ticketContent.test.ts
git commit -m "feat(huntress): self-contained ticket content builders"
```

---

### Task 6: Incident action planner (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/incidents/incidentPlan.ts`
- Test: `ee/server/src/__tests__/unit/huntress/incidentPlan.test.ts`

This pure function is the heart of the lifecycle rules from the spec ("Incident processing"). Every decision lives here so it can be tested exhaustively without a database.

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/incidentPlan.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  planIncidentAction,
  isClosedIncidentStatus,
} from '@ee/lib/integrations/huntress/incidents/incidentPlan';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';

const settings = parseHuntressSettings({
  boardId: 'board-sec',
  fallbackClientId: 'client-fallback',
  fallbackBoardId: 'board-triage',
  severityPriorityMap: { critical: 'p-crit', high: 'p-high', low: 'p-low' },
  autoCloseTickets: false,
  closedStatusId: 'status-closed',
});

function incident(overrides: Partial<HuntressIncidentReport> = {}): HuntressIncidentReport {
  return {
    id: 1,
    account_id: 1,
    agent_id: null,
    organization_id: 10,
    subject: 's',
    summary: null,
    body: null,
    severity: 'high',
    status: 'sent',
    platform: null,
    indicator_types: [],
    indicator_counts: {},
    sent_at: '2026-06-09T10:00:00Z',
    closed_at: null,
    status_updated_at: null,
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

const mappedOrg = { client_id: 'client-1', auto_create_tickets: true };
const unmappedOrg = { client_id: null, auto_create_tickets: true };

describe('isClosedIncidentStatus', () => {
  it('treats closed, dismissed, partner_dismissed as closed', () => {
    expect(isClosedIncidentStatus('closed')).toBe(true);
    expect(isClosedIncidentStatus('dismissed')).toBe(true);
    expect(isClosedIncidentStatus('partner_dismissed')).toBe(true);
    expect(isClosedIncidentStatus('sent')).toBe(false);
    expect(isClosedIncidentStatus('auto_remediating')).toBe(false);
  });
});

describe('planIncidentAction — new incidents', () => {
  it('creates a ticket for an open incident in a mapped org', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({
      kind: 'create_ticket',
      clientId: 'client-1',
      boardId: 'board-sec',
      unmapped: false,
    });
  });

  it('routes an unmapped org to the fallback client and triage board', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: unmappedOrg,
      settings,
    });
    expect(action).toEqual({
      kind: 'create_ticket',
      clientId: 'client-fallback',
      boardId: 'board-triage',
      unmapped: true,
    });
  });

  it('routes a missing mapping row to fallback as well', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: null,
      settings,
    });
    expect(action).toMatchObject({ kind: 'create_ticket', unmapped: true });
  });

  it('records only when the mapping row explicitly opted out (mapped or not)', () => {
    const optedOutMapped = { client_id: 'client-1', auto_create_tickets: false };
    const optedOutUnmapped = { client_id: null, auto_create_tickets: false };
    expect(
      planIncidentAction({ incident: incident(), existingAlert: null, mapping: optedOutMapped, settings })
    ).toEqual({ kind: 'record_only', reason: 'org_opted_out' });
    expect(
      planIncidentAction({ incident: incident(), existingAlert: null, mapping: optedOutUnmapped, settings })
    ).toEqual({ kind: 'record_only', reason: 'org_opted_out' });
  });

  it('records already-closed incidents without a ticket (backfill case)', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'closed' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'record_only', reason: 'already_closed' });
  });

  it('treats auto_remediating as open', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'auto_remediating' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toMatchObject({ kind: 'create_ticket' });
  });

  it('skips deleting incidents entirely', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'deleting' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'skip', reason: 'deleting' });
  });
});

describe('planIncidentAction — existing alerts', () => {
  const alertWithTicket = {
    ticket_id: 'ticket-1',
    status: 'sent',
    metadata: { lastProcessedUpdatedAt: '2026-06-09T10:00:00Z' },
  };

  it('skips when nothing changed since last processing', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'skip', reason: 'unchanged' });
  });

  it('appends a note when updated_at moved forward', () => {
    const action = planIncidentAction({
      incident: incident({ updated_at: '2026-06-09T11:00:00Z' }),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'append_note', close: false, previousStatus: 'sent' });
  });

  it('appends a note when status changed even if updated_at did not move', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'closed' }),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toMatchObject({ kind: 'append_note', previousStatus: 'sent' });
  });

  it('closes the ticket only when autoCloseTickets is on and a closed status is configured', () => {
    const closing = incident({ status: 'closed', updated_at: '2026-06-09T11:00:00Z' });
    const off = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(off).toMatchObject({ kind: 'append_note', close: false });

    const on = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings: { ...settings, autoCloseTickets: true },
    });
    expect(on).toMatchObject({ kind: 'append_note', close: true });

    const noStatus = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings: { ...settings, autoCloseTickets: true, closedStatusId: null },
    });
    expect(noStatus).toMatchObject({ kind: 'append_note', close: false });
  });

  it('updates the record only for alert rows without a ticket (no retroactive tickets)', () => {
    const action = planIncidentAction({
      incident: incident({ updated_at: '2026-06-09T11:00:00Z' }),
      existingAlert: { ticket_id: null, status: 'sent', metadata: {} },
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'record_only', reason: 'no_linked_ticket' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/incidentPlan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/incidents/incidentPlan.ts`:

```typescript
/**
 * Pure lifecycle decision for one Huntress incident. All create/note/close/
 * record/skip rules live here; the processor only executes the decision.
 */

import type {
  HuntressIncidentReport,
  HuntressIncidentStatus,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';

export type IncidentAction =
  | { kind: 'skip'; reason: 'deleting' | 'unchanged' }
  | { kind: 'record_only'; reason: 'org_opted_out' | 'already_closed' | 'no_linked_ticket' }
  | { kind: 'create_ticket'; clientId: string; boardId: string; unmapped: boolean }
  | { kind: 'append_note'; close: boolean; previousStatus: string };

export interface ExistingAlertSummary {
  ticket_id?: string | null;
  status: string;
  metadata?: unknown;
}

export interface MappingSummary {
  client_id?: string | null;
  auto_create_tickets?: boolean | null;
}

export interface PlanIncidentInput {
  incident: HuntressIncidentReport;
  existingAlert: ExistingAlertSummary | null;
  mapping: MappingSummary | null;
  /** Must satisfy isRoutingConfigComplete — the poller guarantees this. */
  settings: HuntressSettings;
}

const CLOSED_STATUSES: HuntressIncidentStatus[] = ['closed', 'dismissed', 'partner_dismissed'];

export function isClosedIncidentStatus(status: string): boolean {
  return (CLOSED_STATUSES as string[]).includes(status);
}

function lastProcessedUpdatedAt(alert: ExistingAlertSummary): string | undefined {
  const metadata = alert.metadata;
  if (metadata && typeof metadata === 'object') {
    const value = (metadata as Record<string, unknown>).lastProcessedUpdatedAt;
    if (typeof value === 'string') return value;
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed.lastProcessedUpdatedAt === 'string') {
        return parsed.lastProcessedUpdatedAt;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function hasIncidentChanged(
  alert: ExistingAlertSummary,
  incident: HuntressIncidentReport
): boolean {
  if (alert.status !== incident.status) return true;
  const last = lastProcessedUpdatedAt(alert);
  if (!last) return true;
  return Date.parse(incident.updated_at) > Date.parse(last);
}

export function planIncidentAction(input: PlanIncidentInput): IncidentAction {
  const { incident, existingAlert, mapping, settings } = input;

  if (incident.status === 'deleting') {
    return { kind: 'skip', reason: 'deleting' };
  }

  if (existingAlert) {
    if (!hasIncidentChanged(existingAlert, incident)) {
      return { kind: 'skip', reason: 'unchanged' };
    }
    if (!existingAlert.ticket_id) {
      return { kind: 'record_only', reason: 'no_linked_ticket' };
    }
    const close =
      isClosedIncidentStatus(incident.status) &&
      settings.autoCloseTickets &&
      Boolean(settings.closedStatusId);
    return { kind: 'append_note', close, previousStatus: existingAlert.status };
  }

  // New incident. An explicit opt-out on the mapping row wins (mapped or not).
  if (mapping && mapping.auto_create_tickets === false) {
    return { kind: 'record_only', reason: 'org_opted_out' };
  }

  if (isClosedIncidentStatus(incident.status)) {
    return { kind: 'record_only', reason: 'already_closed' };
  }

  if (mapping?.client_id) {
    return {
      kind: 'create_ticket',
      clientId: mapping.client_id,
      // boardId/fallback fields are guaranteed by isRoutingConfigComplete.
      boardId: settings.boardId as string,
      unmapped: false,
    };
  }

  return {
    kind: 'create_ticket',
    clientId: settings.fallbackClientId as string,
    boardId: settings.fallbackBoardId as string,
    unmapped: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/incidentPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/incidents/incidentPlan.ts ee/server/src/__tests__/unit/huntress/incidentPlan.test.ts
git commit -m "feat(huntress): pure incident lifecycle planner"
```

---

### Task 7: Huntress REST client (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/huntressClient.ts`
- Test: `ee/server/src/__tests__/unit/huntress/huntressClient.test.ts`

Basic auth (`Base64(key:secret)`), 60 req/min account budget (client throttles to ~1.1s between requests), 429 retry with backoff, `page_token` pagination. The `sleep` function is injectable so tests run instantly.

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/huntressClient.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories run during module import — hoist the mocks they read.
const { axiosGetMock, axiosCreateMock } = vi.hoisted(() => {
  const axiosGetMock = vi.fn();
  const axiosCreateMock = vi.fn(() => ({ get: axiosGetMock }));
  return { axiosGetMock, axiosCreateMock };
});

vi.mock('axios', () => {
  const isAxiosError = (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError);
  return {
    default: { create: axiosCreateMock, isAxiosError },
    isAxiosError,
  };
});

import { HuntressClient } from '@ee/lib/integrations/huntress/huntressClient';

function axios404() {
  return { isAxiosError: true, response: { status: 404, headers: {} } };
}

function axios429(retryAfter?: string) {
  return {
    isAxiosError: true,
    response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
  };
}

describe('HuntressClient', () => {
  let sleeps: number[];
  let client: HuntressClient;

  beforeEach(() => {
    vi.clearAllMocks();
    sleeps = [];
    client = new HuntressClient({
      apiKey: 'key',
      apiSecret: 'secret',
      minRequestIntervalMs: 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
  });

  it('configures axios with the Basic auth header and default base URL', () => {
    expect(axiosCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.huntress.io',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}`,
        }),
      })
    );
  });

  it('getAccount returns the account payload directly', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { id: 1, name: 'Acme', subdomain: 'acme' } });
    const account = await client.getAccount();
    expect(account.subdomain).toBe('acme');
    expect(axiosGetMock).toHaveBeenCalledWith('/v1/account', { params: undefined });
  });

  it('listOrganizations follows page tokens and unwraps the organizations key', async () => {
    axiosGetMock
      .mockResolvedValueOnce({
        data: {
          organizations: [{ id: 1, name: 'A' }],
          pagination: { next_page_token: 't2' },
        },
      })
      .mockResolvedValueOnce({
        data: { organizations: [{ id: 2, name: 'B' }], pagination: {} },
      });

    const orgs = await client.listOrganizations();
    expect(orgs.map((o) => o.id)).toEqual([1, 2]);
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
    expect(axiosGetMock.mock.calls[1][1].params).toMatchObject({ page_token: 't2' });
  });

  it('listIncidentReportsPage requests updated_at desc with limit 500', async () => {
    axiosGetMock.mockResolvedValueOnce({
      data: { incident_reports: [], pagination: {} },
    });
    await client.listIncidentReportsPage({ page_token: 'abc' });
    expect(axiosGetMock).toHaveBeenCalledWith('/v1/incident_reports', {
      params: expect.objectContaining({
        limit: 500,
        sort_field: 'updated_at',
        sort_direction: 'desc',
        page_token: 'abc',
      }),
    });
  });

  it('getAgent unwraps the agent key and returns null on 404', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { agent: { id: 7, hostname: 'SRV01' } } });
    expect((await client.getAgent(7))?.hostname).toBe('SRV01');

    axiosGetMock.mockRejectedValueOnce(axios404());
    expect(await client.getAgent(8)).toBeNull();
  });

  it('getOrganization unwraps the organization key and returns null on 404', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { organization: { id: 9, name: 'Acme' } } });
    expect((await client.getOrganization(9))?.name).toBe('Acme');

    axiosGetMock.mockRejectedValueOnce(axios404());
    expect(await client.getOrganization(10)).toBeNull();
  });

  it('retries 429 responses using Retry-After, then succeeds', async () => {
    axiosGetMock
      .mockRejectedValueOnce(axios429('3'))
      .mockResolvedValueOnce({ data: { id: 1, name: 'Acme', subdomain: 'acme' } });

    const account = await client.getAccount();
    expect(account.id).toBe(1);
    expect(sleeps).toContain(3000);
  });

  it('gives up after exhausting 429 retries', async () => {
    axiosGetMock
      .mockRejectedValueOnce(axios429())
      .mockRejectedValueOnce(axios429())
      .mockRejectedValueOnce(axios429());

    await expect(client.getAccount()).rejects.toMatchObject({
      response: { status: 429 },
    });
  });

  it('throttles consecutive requests to the configured minimum interval', async () => {
    const throttled = new HuntressClient({
      apiKey: 'key',
      apiSecret: 'secret',
      minRequestIntervalMs: 1000,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    axiosGetMock.mockResolvedValue({ data: { id: 1, name: 'a', subdomain: 's' } });

    await throttled.getAccount();
    await throttled.getAccount();

    // Second call must have waited most of the interval.
    expect(Math.max(0, ...sleeps)).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/huntressClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/huntressClient.ts`:

```typescript
/**
 * Huntress public API client.
 *
 * Auth: HTTP Basic — Base64(api_key:api_secret), account-level keys generated
 * at <subdomain>.huntress.io/account/api_credentials.
 * Rate limit: 60 requests/minute sliding window per account; the client
 * spaces requests (default 1.1s) and retries 429s with backoff.
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@/lib/db';
import type {
  HuntressAccount,
  HuntressAgent,
  HuntressIncidentReportsPage,
  HuntressOrganization,
  HuntressOrganizationsPage,
} from '../../../interfaces/huntress.interfaces';

export const HUNTRESS_DEFAULT_BASE_URL = 'https://api.huntress.io';
export const HUNTRESS_API_KEY_SECRET = 'huntress_api_key';
export const HUNTRESS_API_SECRET_SECRET = 'huntress_api_secret';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1_100; // ~54 req/min, under the 60/min budget
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HuntressClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  minRequestIntervalMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ListIncidentReportsPageParams {
  page_token?: string;
  limit?: number;
}

export class HuntressClient {
  private http: AxiosInstance;
  private minIntervalMs: number;
  private lastRequestAt = 0;
  private sleep: (ms: number) => Promise<void>;

  constructor(config: HuntressClientConfig) {
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    this.minIntervalMs = config.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
    this.sleep = config.sleep ?? defaultSleep;
    this.http = axios.create({
      baseURL: config.baseUrl || HUNTRESS_DEFAULT_BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${token}`,
      },
    });
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();

      try {
        const response = await this.http.get<T>(path, { params });
        return response.data;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
          const retryAfterRaw = axios.isAxiosError(error)
            ? error.response?.headers?.['retry-after']
            : undefined;
          const retryAfter = Number(retryAfterRaw);
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : DEFAULT_RATE_LIMIT_BACKOFF_MS;
          logger.warn('[HuntressClient] 429 rate limited, backing off', { path, backoff });
          await this.sleep(backoff);
          continue;
        }
        throw error;
      }
    }
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }

  async getAccount(): Promise<HuntressAccount> {
    return this.get<HuntressAccount>('/v1/account');
  }

  async listOrganizations(): Promise<HuntressOrganization[]> {
    const organizations: HuntressOrganization[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.get<HuntressOrganizationsPage>('/v1/organizations', {
        limit: 500,
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      organizations.push(...(page.organizations ?? []));
      pageToken = page.pagination?.next_page_token ?? undefined;
    } while (pageToken);

    return organizations;
  }

  async getOrganization(id: number): Promise<HuntressOrganization | null> {
    const data = await this.getOrNull<{ organization: HuntressOrganization }>(
      `/v1/organizations/${id}`
    );
    return data?.organization ?? null;
  }

  async listIncidentReportsPage(
    params: ListIncidentReportsPageParams = {}
  ): Promise<HuntressIncidentReportsPage> {
    return this.get<HuntressIncidentReportsPage>('/v1/incident_reports', {
      limit: params.limit ?? 500,
      sort_field: 'updated_at',
      sort_direction: 'desc',
      ...(params.page_token ? { page_token: params.page_token } : {}),
    });
  }

  async getAgent(id: number): Promise<HuntressAgent | null> {
    const data = await this.getOrNull<{ agent: HuntressAgent }>(`/v1/agents/${id}`);
    return data?.agent ?? null;
  }
}

/**
 * Build a client from tenant-scoped secrets. Returns null when credentials
 * are not configured (caller surfaces the error state).
 */
export async function createHuntressClient(tenantId: string): Promise<HuntressClient | null> {
  const secretProvider = await getSecretProviderInstance();
  const [apiKey, apiSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenantId, HUNTRESS_API_KEY_SECRET),
    secretProvider.getTenantSecret(tenantId, HUNTRESS_API_SECRET_SECRET),
  ]);
  if (!apiKey || !apiSecret) return null;

  const { knex } = await createTenantKnex();
  const row = await knex('rmm_integrations')
    .where({ tenant: tenantId, provider: 'huntress' })
    .first('instance_url');

  return new HuntressClient({
    apiKey,
    apiSecret,
    baseUrl: row?.instance_url || undefined,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/huntressClient.test.ts`
Expected: PASS. (The test never exercises `createHuntressClient`, so the unmocked `@/lib/db` import is fine — it is only loaded, not called.)

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/huntressClient.ts ee/server/src/__tests__/unit/huntress/huntressClient.test.ts
git commit -m "feat(huntress): REST client with basic auth, throttle, 429 retry"
```

---

### Task 8: Ticket creator + incident processor (DB-backed TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts`
- Create: `ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts`
- Test: `ee/server/src/__tests__/integration/huntressIncidentProcessor.integration.test.ts`

These two modules are tested against a real database (the EE integration-test harness runs the actual migrations), which pins the live schema: `tickets.board_id`, `statuses.name/item_type/is_closed`, `comments.comment/comment_type`, `tenant_external_entity_mappings.tenant_id`. Both take their DB handle as a parameter (`knex`/`trx`) — no module mocks needed.

**Precondition:** dev Postgres running (`DB_PORT` defaults to 5432, `APP_ENV=test`).

- [ ] **Step 1: Write the failing integration test**

Create `ee/server/src/__tests__/integration/huntressIncidentProcessor.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';
import {
  processIncident,
  type ProcessIncidentDeps,
} from '@ee/lib/integrations/huntress/incidents/incidentProcessor';

const HOOK_TIMEOUT = 180_000;

let db: Knex;

// Fixture ids
const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const fallbackClientId = uuidv4();
const securityBoardId = uuidv4();
const triageBoardId = uuidv4();
const statusOpenId = uuidv4();
const statusClosedId = uuidv4();
const pCritId = uuidv4();
const pHighId = uuidv4();
const pLowId = uuidv4();
const integrationId = uuidv4();
const assetId = uuidv4();

const settings = parseHuntressSettings({
  accountSubdomain: 'acme',
  boardId: securityBoardId,
  fallbackClientId,
  fallbackBoardId: triageBoardId,
  severityPriorityMap: { critical: pCritId, high: pHighId, low: pLowId },
  autoCloseTickets: true,
  closedStatusId: statusClosedId,
});

const integration = { integration_id: integrationId, settings };

const deps: ProcessIncidentDeps = {
  getAgent: async (id) =>
    id === 7
      ? {
          id: 7,
          hostname: 'SRV01',
          os: 'Windows Server 2022',
          ipv4_address: '10.0.0.5',
          external_ip: null,
          serial_number: 'SN-1',
          last_callback_at: null,
        }
      : null,
  getOrganization: async (id) => ({ id, name: `Discovered Org ${id}` }),
};

function incident(overrides: Partial<HuntressIncidentReport> = {}): HuntressIncidentReport {
  return {
    id: 1000,
    account_id: 1,
    agent_id: 7,
    organization_id: 500,
    subject: 'HIGH - Incident on SRV01',
    summary: 'Malicious task detected.',
    body: null,
    severity: 'high',
    status: 'sent',
    platform: 'windows',
    indicator_types: ['footholds'],
    indicator_counts: { footholds: 1 },
    sent_at: '2026-06-09T10:00:00Z',
    closed_at: null,
    status_updated_at: '2026-06-09T10:00:00Z',
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'Huntress Test Tenant' }
      : { client_name: 'Huntress Test Tenant' }),
    email: `huntress-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `huntress-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `huntress-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('clients').insert([
    {
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme Corp',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: fallbackClientId,
      client_name: 'Internal (Unmapped Security)',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: securityBoardId,
      board_name: 'Security',
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      board_id: triageBoardId,
      board_name: 'Security Triage',
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  const statusItemType = (await hasColumn('statuses', 'item_type'))
    ? { item_type: 'ticket' }
    : { status_type: 'ticket' };
  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: statusOpenId,
      name: 'Open',
      ...statusItemType,
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: statusClosedId,
      name: 'Closed',
      ...statusItemType,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
    },
  ]);

  await db('priorities').insert(
    [
      { id: pCritId, name: 'Critical', order: 1 },
      { id: pHighId, name: 'High', order: 2 },
      { id: pLowId, name: 'Medium', order: 3 },
    ].map((p) => ({
      tenant: tenantId,
      priority_id: p.id,
      priority_name: p.name,
      item_type: 'ticket',
      order_number: p.order,
      color: '#888888',
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );

  await db('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'huntress',
    instance_url: 'https://api.huntress.io',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify(settings),
  });

  // Org 500 is mapped to Acme; org 600 has no mapping row at all.
  await db('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: '500',
    external_organization_name: 'Acme Corp',
    client_id: clientId,
    auto_sync_assets: false,
    auto_create_tickets: true,
  });

  await db('assets').insert({
    tenant: tenantId,
    asset_id: assetId,
    asset_type: 'workstation',
    name: 'SRV01',
    asset_tag: 'HT-1',
    serial_number: 'SN-1',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!db) return;
  for (const table of [
    'comments',
    'comment_threads',
    'asset_associations',
    'rmm_alerts',
    'tickets',
    'tenant_external_entity_mappings',
    'rmm_organization_mappings',
    'rmm_integrations',
    'assets',
    'priorities',
    'statuses',
    'boards',
    'clients',
    'users',
    'tenants',
  ]) {
    const tenantColumn = table === 'tenant_external_entity_mappings' ? 'tenant_id' : 'tenant';
    await db(table)
      .where({ [tenantColumn]: tenantId })
      .del()
      .catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('processIncident (DB integration)', () => {
  it('creates a routed, self-contained ticket for a new mapped incident', async () => {
    const result = await processIncident(db, tenantId, integration, incident(), deps);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('create_ticket');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, integration_id: integrationId, external_alert_id: '1000' })
      .first();
    expect(alert).toBeTruthy();
    expect(alert.ticket_id).toBeTruthy();
    expect(alert.severity).toBe('high');
    expect(alert.asset_id).toBe(assetId);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.board_id).toBe(securityBoardId);
    expect(ticket.priority_id).toBe(pHighId);
    expect(ticket.status_id).toBe(statusOpenId);
    expect(ticket.source).toBe('huntress');
    expect(ticket.source_reference).toBe('1000');
    expect(ticket.title).toContain('[Huntress]');
    expect(ticket.attributes?.description ?? ticket.description).toContain('SRV01');
    expect(ticket.attributes?.description ?? ticket.description).toContain(
      'https://acme.huntress.io/incident_reports/1000'
    );

    const association = await db('asset_associations')
      .where({ tenant: tenantId, asset_id: assetId, entity_id: alert.ticket_id })
      .first();
    expect(association).toBeTruthy();

    const note = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(note).toBeTruthy();

    const entityMapping = await db('tenant_external_entity_mappings')
      .where({ tenant_id: tenantId, integration_type: 'huntress', external_entity_id: '7' })
      .first();
    expect(entityMapping?.alga_entity_id).toBe(assetId);
  });

  it('is idempotent — reprocessing the unchanged incident creates nothing new', async () => {
    const before = await db('tickets').where({ tenant: tenantId }).count('* as n').first();
    const result = await processIncident(db, tenantId, integration, incident(), deps);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('skip');
    const after = await db('tickets').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(after?.n)).toBe(Number(before?.n));
  });

  it('appends a note and auto-closes when the incident closes', async () => {
    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '1000' })
      .first();
    const notesBefore = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .count('* as n')
      .first();

    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ status: 'closed', closed_at: '2026-06-09T12:00:00Z', updated_at: '2026-06-09T12:00:00Z' }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('append_note');

    const notesAfter = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .count('* as n')
      .first();
    expect(Number(notesAfter?.n)).toBe(Number(notesBefore?.n) + 1);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.status_id).toBe(statusClosedId);
  });

  it('routes an unknown org to the fallback client and discovers the mapping row', async () => {
    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ id: 2000, organization_id: 600, agent_id: null, subject: 'LOW - M365 incident' }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('create_ticket');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '2000' })
      .first();
    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.client_id).toBe(fallbackClientId);
    expect(ticket.board_id).toBe(triageBoardId);
    expect(ticket.title).toContain('[Unmapped Org]');

    const discovered = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '600' })
      .first();
    expect(discovered).toBeTruthy();
    expect(discovered.client_id).toBeNull();
    expect(discovered.external_organization_name).toBe('Discovered Org 600');
  });

  it('records without a ticket when the mapping row opted out', async () => {
    await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '600' })
      .update({ auto_create_tickets: false });

    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ id: 3000, organization_id: 600, agent_id: null }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('record_only');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '3000' })
      .first();
    expect(alert).toBeTruthy();
    expect(alert.ticket_id).toBeNull();
  });
});
```

Note: the `attributes?.description ?? description` fallback exists because the tickets schema stores the description in a column on this branch; the assertion accepts either location. Everything else asserts exact columns — if an insert column is wrong, this test fails and the implementation (not the test) gets fixed.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/integration/huntressIncidentProcessor.integration.test.ts`
Expected: FAIL — `incidentProcessor` module not found.

- [ ] **Step 3: Write the ticket creator**

Create `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts`:

```typescript
/**
 * Transactional ticket creation for Huntress incidents. Mirrors the NinjaOne
 * ticket creator (ee/server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts)
 * but takes the caller's transaction so the alert-row update commits
 * atomically with the ticket, and writes the post-rename board/category
 * columns.
 */

import { Knex } from 'knex';

export interface CreateHuntressTicketParams {
  clientId: string;
  boardId: string;
  priorityId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  title: string;
  body: string;
  /** Internal audit note added as the first comment. */
  note: string;
  /** Huntress incident id, stringified. */
  sourceReference: string;
  assetId?: string | null;
}

export interface CreatedHuntressTicket {
  ticket_id: string;
  ticket_number: string;
}

export async function createHuntressTicket(
  trx: Knex.Transaction,
  tenantId: string,
  params: CreateHuntressTicketParams
): Promise<CreatedHuntressTicket> {
  const defaultStatus = await trx('statuses')
    .where({ tenant: tenantId, item_type: 'ticket', is_default: true })
    .first();
  if (!defaultStatus) {
    throw new Error('No default ticket status configured for tenant');
  }

  const ticketNumber = await generateTicketNumber(trx, tenantId);
  const now = new Date().toISOString();

  const [ticket] = await trx('tickets')
    .insert({
      tenant: tenantId,
      ticket_number: ticketNumber,
      title: params.title,
      client_id: params.clientId,
      status_id: defaultStatus.status_id,
      priority_id: params.priorityId ?? null,
      board_id: params.boardId,
      category_id: params.categoryId ?? null,
      subcategory_id: params.subcategoryId ?? null,
      description: params.body,
      source: 'huntress',
      source_reference: params.sourceReference,
      created_at: now,
      updated_at: now,
    })
    .returning(['ticket_id', 'ticket_number']);

  if (params.assetId) {
    await trx('asset_associations').insert({
      tenant: tenantId,
      asset_id: params.assetId,
      entity_id: ticket.ticket_id,
      entity_type: 'ticket',
      relationship_type: 'related',
      created_by: null,
      created_at: now,
    });
  }

  await addTicketInternalNote(trx, tenantId, ticket.ticket_id, params.note);

  return ticket as CreatedHuntressTicket;
}

/**
 * System-authored internal note. comments.thread_id is NOT NULL, so the
 * thread row is created first (same pattern as the NinjaOne creator).
 */
export async function addTicketInternalNote(
  trx: Knex.Transaction,
  tenantId: string,
  ticketId: string,
  note: string
): Promise<void> {
  const now = new Date().toISOString();
  const generated = await trx.raw(
    'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
  );
  const ids = generated.rows?.[0] as { comment_id: string; thread_id: string } | undefined;
  if (!ids?.comment_id || !ids?.thread_id) {
    throw new Error('Failed to generate comment/thread identifiers');
  }

  await trx('comment_threads').insert({
    tenant: tenantId,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: ids.comment_id,
    is_internal: true,
    reply_count: 0,
    last_activity_at: now,
    created_at: now,
    created_by: null,
  });

  await trx('comments').insert({
    tenant: tenantId,
    comment_id: ids.comment_id,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    user_id: null,
    comment_type: 'internal_note',
    comment: note,
    is_internal: true,
    created_at: now,
  });
}

/** Max ticket_number + 1 with the tenant's configured prefix (NinjaOne pattern). */
async function generateTicketNumber(trx: Knex.Transaction, tenantId: string): Promise<string> {
  const result = await trx('tickets')
    .where({ tenant: tenantId })
    .max('ticket_number as max_number')
    .first();

  let nextNumber = 1;
  if (result?.max_number) {
    const match = String(result.max_number).match(/(\d+)$/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  const settings = await trx('tenant_settings')
    .where({ tenant: tenantId, setting_key: 'ticket_number_prefix' })
    .first();
  const prefix = settings?.setting_value || 'TKT-';

  return `${prefix}${String(nextNumber).padStart(6, '0')}`;
}
```

- [ ] **Step 4: Write the incident processor**

Create `ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts`:

```typescript
/**
 * Executes the planner's decision for one incident against the database.
 * Takes its Knex handle as a parameter so integration tests run it on a real
 * test database with no module mocks.
 */

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import type {
  HuntressAgent,
  HuntressIncidentReport,
  HuntressOrganization,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';
import { planIncidentAction, type IncidentAction } from './incidentPlan';
import {
  buildCreationNote,
  buildPortalUrl,
  buildTicketBody,
  buildTicketTitle,
  buildUpdateNote,
} from './ticketContent';
import { addTicketInternalNote, createHuntressTicket } from './ticketCreator';

export interface ProcessIncidentDeps {
  getAgent: (agentId: number) => Promise<HuntressAgent | null>;
  getOrganization: (orgId: number) => Promise<HuntressOrganization | null>;
}

export interface ProcessIncidentResult {
  ok: boolean;
  action: IncidentAction['kind'] | 'error';
  ticketId?: string;
  error?: string;
}

export interface HuntressIntegrationContext {
  integration_id: string;
  settings: HuntressSettings;
}

export async function processIncident(
  knex: Knex,
  tenantId: string,
  integration: HuntressIntegrationContext,
  incident: HuntressIncidentReport,
  deps: ProcessIncidentDeps
): Promise<ProcessIncidentResult> {
  const externalAlertId = String(incident.id);

  try {
    const existingAlert = await knex('rmm_alerts')
      .where({
        tenant: tenantId,
        integration_id: integration.integration_id,
        external_alert_id: externalAlertId,
      })
      .first();

    let mapping =
      incident.organization_id != null
        ? await knex('rmm_organization_mappings')
            .where({
              tenant: tenantId,
              integration_id: integration.integration_id,
              external_organization_id: String(incident.organization_id),
            })
            .first()
        : null;

    // Org created in Huntress after the last org sync: discover it on demand
    // so the mapping screen stays current, then fall through to fallback
    // routing (the new row is unmapped).
    if (!mapping && incident.organization_id != null) {
      const org = await deps
        .getOrganization(incident.organization_id)
        .catch(() => null);
      const [inserted] = await knex('rmm_organization_mappings')
        .insert({
          tenant: tenantId,
          mapping_id: knex.raw('gen_random_uuid()'),
          integration_id: integration.integration_id,
          external_organization_id: String(incident.organization_id),
          external_organization_name: org?.name ?? `Huntress org ${incident.organization_id}`,
          client_id: null,
          auto_sync_assets: false,
          auto_create_tickets: true,
          metadata: JSON.stringify({ discoveredVia: 'incident_poll' }),
        })
        .onConflict(['tenant', 'integration_id', 'external_organization_id'])
        .ignore()
        .returning('*');
      mapping =
        inserted ??
        (await knex('rmm_organization_mappings')
          .where({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_organization_id: String(incident.organization_id),
          })
          .first());
    }

    const action = planIncidentAction({
      incident,
      existingAlert: existingAlert ?? null,
      mapping: mapping ?? null,
      settings: integration.settings,
    });

    if (action.kind === 'skip') {
      return { ok: true, action: action.kind };
    }

    // Agent details and asset match are fetched outside the transaction
    // (API call + read-only query).
    let agent: HuntressAgent | null = null;
    let matchedAssetId: string | null = null;
    if (action.kind === 'create_ticket' && incident.agent_id != null) {
      agent = await deps.getAgent(incident.agent_id).catch(() => null);
      if (!action.unmapped && agent?.hostname) {
        matchedAssetId = await matchAsset(knex, tenantId, action.clientId, agent);
      }
    }

    const portalUrl = buildPortalUrl(integration.settings.accountSubdomain, incident.id);
    const now = new Date().toISOString();
    const alertColumns = {
      severity: incident.severity,
      status: incident.status,
      message: incident.subject ?? null,
      device_name: agent?.hostname ?? existingAlert?.device_name ?? null,
      external_device_id: incident.agent_id != null ? String(incident.agent_id) : null,
      triggered_at: incident.sent_at ?? incident.updated_at,
      resolved_at: incident.closed_at,
      metadata: JSON.stringify({
        summary: incident.summary,
        platform: incident.platform,
        indicatorTypes: incident.indicator_types,
        indicatorCounts: incident.indicator_counts,
        organizationId: incident.organization_id,
        portalUrl,
        statusUpdatedAt: incident.status_updated_at,
        lastProcessedUpdatedAt: incident.updated_at,
      }),
      updated_at: now,
    };

    const ticketId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let alertId: string;
      if (existingAlert) {
        alertId = existingAlert.alert_id;
        await trx('rmm_alerts')
          .where({ tenant: tenantId, alert_id: alertId })
          .update(alertColumns);
      } else {
        const [inserted] = await trx('rmm_alerts')
          .insert({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_alert_id: externalAlertId,
            asset_id: matchedAssetId,
            ...alertColumns,
          })
          .returning('alert_id');
        alertId = (inserted as { alert_id: string }).alert_id;
      }

      if (action.kind === 'create_ticket') {
        const severityKey = incident.severity as keyof HuntressSettings['severityPriorityMap'];
        const ticket = await createHuntressTicket(trx, tenantId, {
          clientId: action.clientId,
          boardId: action.boardId,
          priorityId: integration.settings.severityPriorityMap[severityKey],
          categoryId: action.unmapped ? null : integration.settings.categoryId,
          subcategoryId: action.unmapped ? null : integration.settings.subcategoryId,
          title: buildTicketTitle(incident, { unmapped: action.unmapped }),
          body: buildTicketBody(incident, agent, portalUrl, {
            unmapped: action.unmapped,
            orgName: mapping?.external_organization_name ?? undefined,
          }),
          note: buildCreationNote(incident),
          sourceReference: externalAlertId,
          assetId: matchedAssetId,
        });

        await trx('rmm_alerts')
          .where({ tenant: tenantId, alert_id: alertId })
          .update({ ticket_id: ticket.ticket_id, asset_id: matchedAssetId });

        if (matchedAssetId && agent) {
          await upsertEntityMapping(trx, tenantId, incident, agent, matchedAssetId);
        }
        return ticket.ticket_id;
      }

      if (action.kind === 'append_note' && existingAlert?.ticket_id) {
        await addTicketInternalNote(
          trx,
          tenantId,
          existingAlert.ticket_id,
          buildUpdateNote(action.previousStatus, incident)
        );
        if (action.close && integration.settings.closedStatusId) {
          await trx('tickets')
            .where({ tenant: tenantId, ticket_id: existingAlert.ticket_id })
            .update({ status_id: integration.settings.closedStatusId, updated_at: now });
        }
        return existingAlert.ticket_id as string;
      }

      return undefined;
    });

    return { ok: true, action: action.kind, ticketId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[Huntress] Failed to process incident', {
      tenantId,
      incidentId: incident.id,
      error: message,
    });
    return { ok: false, action: 'error', error: message };
  }
}

/** Unique hostname match within the mapped client; serial number tie-breaks. */
async function matchAsset(
  knex: Knex,
  tenantId: string,
  clientId: string,
  agent: HuntressAgent
): Promise<string | null> {
  const candidates = await knex('assets')
    .where({ tenant: tenantId, client_id: clientId })
    .whereRaw('LOWER(name) = ?', [String(agent.hostname).toLowerCase()])
    .select('asset_id', 'serial_number');

  if (candidates.length === 1) return candidates[0].asset_id;
  if (candidates.length > 1 && agent.serial_number) {
    const bySerial = candidates.filter((c) => c.serial_number === agent.serial_number);
    if (bySerial.length === 1) return bySerial[0].asset_id;
  }
  return null;
}

async function upsertEntityMapping(
  trx: Knex.Transaction,
  tenantId: string,
  incident: HuntressIncidentReport,
  agent: HuntressAgent,
  assetId: string
): Promise<void> {
  const existing = await trx('tenant_external_entity_mappings')
    .where({
      tenant_id: tenantId,
      integration_type: 'huntress',
      external_entity_id: String(agent.id),
    })
    .first();
  if (existing) {
    await trx('tenant_external_entity_mappings')
      .where({ id: existing.id })
      .update({
        alga_entity_id: assetId,
        sync_status: 'synced',
        last_synced_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    return;
  }
  await trx('tenant_external_entity_mappings').insert({
    tenant_id: tenantId,
    integration_type: 'huntress',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: String(agent.id),
    external_realm_id:
      incident.organization_id != null ? String(incident.organization_id) : null,
    sync_status: 'synced',
    last_synced_at: trx.fn.now(),
    metadata: JSON.stringify({ hostname: agent.hostname }),
  });
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/integration/huntressIncidentProcessor.integration.test.ts`
Expected: PASS (5 tests). If an insert fails on a column name, fix the implementation insert (the migrations are the source of truth), not the test assertions.

- [ ] **Step 6: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts ee/server/src/__tests__/integration/huntressIncidentProcessor.integration.test.ts
git commit -m "feat(huntress): transactional ticket creation and incident processing"
```

---

### Task 9: Organization sync with auto-match (DB-backed TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/organizations/orgSync.ts`
- Test: `ee/server/src/__tests__/integration/huntressOrgSync.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `ee/server/src/__tests__/integration/huntressOrgSync.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { syncHuntressOrganizations } from '@ee/lib/integrations/huntress/organizations/orgSync';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantId = uuidv4();
const integrationId = uuidv4();
const acmeClientId = uuidv4();

const stubClient = {
  listOrganizations: async () => [
    { id: 1, name: 'Acme, Inc.' },   // exact normalized match → auto-link
    { id: 2, name: 'Globex' },       // ambiguous (two Globex clients) → stay unmapped
    { id: 3, name: 'Initech' },      // no match → stay unmapped
  ],
};

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  const hasCompanyName = await db.schema.hasColumn('tenants', 'company_name');
  await db('tenants').insert({
    tenant: tenantId,
    ...(hasCompanyName
      ? { company_name: 'OrgSync Test Tenant' }
      : { client_name: 'OrgSync Test Tenant' }),
    email: `orgsync-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('clients').insert(
    [
      { id: acmeClientId, name: 'ACME Inc' },
      { id: uuidv4(), name: 'Globex' },
      { id: uuidv4(), name: 'globex' },
    ].map((c) => ({
      tenant: tenantId,
      client_id: c.id,
      client_name: c.name,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );

  await db('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'huntress',
    is_active: true,
    settings: JSON.stringify({}),
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!db) return;
  for (const table of ['rmm_organization_mappings', 'rmm_integrations', 'clients', 'tenants']) {
    await db(table).where({ tenant: tenantId }).del().catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('syncHuntressOrganizations (DB integration)', () => {
  it('creates mapping rows and auto-links exact normalized name matches', async () => {
    const result = await syncHuntressOrganizations(db, tenantId, integrationId, stubClient);
    expect(result.created).toBe(3);
    expect(result.autoMatched).toBe(1);

    const rows = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId })
      .orderBy('external_organization_id');

    expect(rows).toHaveLength(3);

    const acme = rows.find((r: any) => r.external_organization_id === '1');
    expect(acme.client_id).toBe(acmeClientId);
    const acmeMeta = typeof acme.metadata === 'string' ? JSON.parse(acme.metadata) : acme.metadata;
    expect(acmeMeta.auto_matched).toBe(true);

    const globex = rows.find((r: any) => r.external_organization_id === '2');
    expect(globex.client_id).toBeNull();

    const initech = rows.find((r: any) => r.external_organization_id === '3');
    expect(initech.client_id).toBeNull();
    expect(initech.auto_create_tickets).toBe(true);
  });

  it('updates names on re-sync without touching manual mappings', async () => {
    // Simulate a manual mapping the user made, plus a renamed org in Huntress.
    const manualClient = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: manualClient,
      client_name: 'Manually Mapped',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '3' })
      .update({ client_id: manualClient });

    const renamingClient = {
      listOrganizations: async () => [{ id: 3, name: 'Initech Renamed' }],
    };
    const result = await syncHuntressOrganizations(db, tenantId, integrationId, renamingClient);
    expect(result.updated).toBe(1);

    const row = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '3' })
      .first();
    expect(row.external_organization_name).toBe('Initech Renamed');
    expect(row.client_id).toBe(manualClient); // manual mapping preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/integration/huntressOrgSync.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/organizations/orgSync.ts`:

```typescript
/**
 * Huntress organization discovery: upsert one mapping row per org, refresh
 * names on every sync, and auto-link only exact normalized name matches.
 */

import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type { HuntressOrganization } from '../../../../interfaces/huntress.interfaces';
import { findExactNameMatch } from './nameMatch';

export interface OrgSyncClient {
  listOrganizations: () => Promise<HuntressOrganization[]>;
}

export interface OrgSyncResult {
  total: number;
  created: number;
  updated: number;
  autoMatched: number;
}

export async function syncHuntressOrganizations(
  knex: Knex,
  tenantId: string,
  integrationId: string,
  client: OrgSyncClient
): Promise<OrgSyncResult> {
  const organizations = await client.listOrganizations();
  let created = 0;
  let updated = 0;

  for (const org of organizations) {
    const externalId = String(org.id);
    const existing = await knex('rmm_organization_mappings')
      .where({
        tenant: tenantId,
        integration_id: integrationId,
        external_organization_id: externalId,
      })
      .first();

    if (existing) {
      await knex('rmm_organization_mappings')
        .where({ tenant: tenantId, mapping_id: existing.mapping_id })
        .update({
          external_organization_name: org.name,
          last_synced_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      updated += 1;
    } else {
      await knex('rmm_organization_mappings').insert({
        tenant: tenantId,
        mapping_id: knex.raw('gen_random_uuid()'),
        integration_id: integrationId,
        external_organization_id: externalId,
        external_organization_name: org.name,
        client_id: null,
        auto_sync_assets: false,
        auto_create_tickets: true,
        last_synced_at: knex.fn.now(),
      });
      created += 1;
    }
  }

  const autoMatched = await autoMatchUnmapped(knex, tenantId, integrationId);

  logger.info('[Huntress] Organization sync completed', {
    tenantId,
    total: organizations.length,
    created,
    updated,
    autoMatched,
  });

  return { total: organizations.length, created, updated, autoMatched };
}

async function autoMatchUnmapped(
  knex: Knex,
  tenantId: string,
  integrationId: string
): Promise<number> {
  const clients = await knex('clients')
    .where({ tenant: tenantId, is_inactive: false })
    .select('client_id', 'client_name');

  const unmapped = await knex('rmm_organization_mappings')
    .where({ tenant: tenantId, integration_id: integrationId })
    .whereNull('client_id')
    .select('mapping_id', 'external_organization_name', 'metadata');

  let matched = 0;
  for (const mapping of unmapped) {
    if (!mapping.external_organization_name) continue;
    const clientId = findExactNameMatch(mapping.external_organization_name, clients);
    if (!clientId) continue;

    const existingMetadata =
      typeof mapping.metadata === 'string'
        ? JSON.parse(mapping.metadata || '{}')
        : mapping.metadata ?? {};
    await knex('rmm_organization_mappings')
      .where({ tenant: tenantId, mapping_id: mapping.mapping_id })
      .update({
        client_id: clientId,
        metadata: JSON.stringify({ ...existingMetadata, auto_matched: true }),
        updated_at: knex.fn.now(),
      });
    matched += 1;
  }
  return matched;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/integration/huntressOrgSync.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/organizations/orgSync.ts ee/server/src/__tests__/integration/huntressOrgSync.integration.test.ts
git commit -m "feat(huntress): organization sync with exact-name auto-match"
```

---

### Task 10: Incident poller (TDD)

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/incidents/incidentPoller.ts`
- Test: `ee/server/src/__tests__/unit/huntress/incidentPoller.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/huntress/incidentPoller.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';

// vi.mock factories run during module import — hoist everything they read.
const { state, processIncidentMock, createKnexMock } = vi.hoisted(() => {
  const state: {
    integrationRow: Record<string, unknown> | undefined;
    updates: Array<Record<string, unknown>>;
    client: unknown;
  } = { integrationRow: undefined, updates: [], client: undefined };

  function createKnexMock() {
    const builder: any = {
      where: vi.fn(() => builder),
      first: vi.fn(async () => (state.integrationRow ? { ...state.integrationRow } : undefined)),
      update: vi.fn(async (vals: Record<string, unknown>) => {
        state.updates.push(vals);
        return 1;
      }),
    };
    const knex: any = vi.fn(() => builder);
    knex.fn = { now: () => new Date().toISOString() };
    return knex;
  }

  return { state, processIncidentMock: vi.fn(), createKnexMock };
});

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: createKnexMock(), tenant: 'tenant-1' })),
}));

vi.mock('@ee/lib/integrations/huntress/incidents/incidentProcessor', () => ({
  processIncident: processIncidentMock,
}));

vi.mock('@ee/lib/integrations/huntress/huntressClient', () => ({
  createHuntressClient: vi.fn(async () => state.client),
}));

import { pollHuntressIncidents } from '@ee/lib/integrations/huntress/incidents/incidentPoller';

function incident(id: number, updatedAt: string): HuntressIncidentReport {
  return {
    id,
    account_id: 1,
    agent_id: null,
    organization_id: 1,
    subject: `i${id}`,
    summary: null,
    body: null,
    severity: 'low',
    status: 'sent',
    platform: null,
    indicator_types: [],
    indicator_counts: {},
    sent_at: updatedAt,
    closed_at: null,
    status_updated_at: null,
    updated_at: updatedAt,
  };
}

const completeSettings = {
  boardId: 'b1',
  fallbackClientId: 'c1',
  fallbackBoardId: 'b2',
  severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
  incidentCursor: '2026-06-09T08:00:00Z',
  backfillDays: 7,
  pollIntervalMinutes: 5,
};

function clientReturning(incidents: HuntressIncidentReport[]) {
  return {
    listIncidentReportsPage: vi.fn(async () => ({
      // API returns newest first.
      incident_reports: [...incidents].sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      ),
      pagination: {},
    })),
    getAgent: vi.fn(),
    getOrganization: vi.fn(),
  };
}

describe('pollHuntressIncidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.updates = [];
    state.integrationRow = {
      tenant: 'tenant-1',
      integration_id: 'int-1',
      provider: 'huntress',
      is_active: true,
      settings: completeSettings,
    };
    state.client = clientReturning([]);
  });

  it('skips without polling when routing config is incomplete', async () => {
    state.integrationRow = {
      ...state.integrationRow!,
      settings: { ...completeSettings, boardId: undefined },
    };
    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });
    expect(result.skipped).toBe('routing_config_incomplete');
    expect(processIncidentMock).not.toHaveBeenCalled();
  });

  it('marks the integration errored when credentials are missing', async () => {
    state.client = null;
    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });
    expect(result.success).toBe(false);
    expect(state.updates.some((u) => u.sync_status === 'error')).toBe(true);
  });

  it('processes incidents in ascending order and advances the cursor past all of them', async () => {
    state.client = clientReturning([
      incident(1, '2026-06-09T09:00:00Z'),
      incident(2, '2026-06-09T10:00:00Z'),
    ]);
    processIncidentMock.mockResolvedValue({ ok: true, action: 'create_ticket' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(processIncidentMock.mock.calls.map((c) => c[3].id)).toEqual([1, 2]);

    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('completed');
    expect(JSON.parse(String(finalUpdate.settings)).incidentCursor).toBe('2026-06-09T10:00:00Z');
  });

  it('stops at the first failure so the failed incident is retried next cycle', async () => {
    state.client = clientReturning([
      incident(1, '2026-06-09T09:00:00Z'),
      incident(2, '2026-06-09T10:00:00Z'),
      incident(3, '2026-06-09T11:00:00Z'),
    ]);
    processIncidentMock
      .mockResolvedValueOnce({ ok: true, action: 'create_ticket' })
      .mockResolvedValueOnce({ ok: false, action: 'error', error: 'boom' })
      .mockResolvedValue({ ok: true, action: 'create_ticket' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(false);
    expect(result.processed).toBe(1);
    expect(processIncidentMock).toHaveBeenCalledTimes(2); // third never attempted

    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('error');
    expect(finalUpdate.sync_error).toBe('boom');
    // Cursor stops at the last successful incident.
    expect(JSON.parse(String(finalUpdate.settings)).incidentCursor).toBe('2026-06-09T09:00:00Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/incidentPoller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `ee/server/src/lib/integrations/huntress/incidents/incidentPoller.ts`:

```typescript
/**
 * One poll cycle for one tenant's Huntress integration: cursor-walk new
 * incident activity, process each incident ascending, advance the cursor
 * only past successes, and record sync status on the integration row.
 */

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@/lib/db';
import { runRmmSyncWithTransport } from '../../rmm/sync/syncOrchestration';
import { createHuntressClient } from '../huntressClient';
import { isRoutingConfigComplete, parseHuntressSettings } from '../settings';
import { collectIncidentsSince } from './cursorWalk';
import { processIncident } from './incidentProcessor';

export interface HuntressPollInput {
  tenantId: string;
  integrationId: string;
  trigger?: 'scheduled' | 'manual';
}

export interface HuntressPollResult {
  success: boolean;
  skipped?: 'integration_not_found' | 'routing_config_incomplete' | 'missing_credentials';
  processed: number;
  failed: number;
  cursor?: string | null;
  error?: string;
}

export async function pollHuntressIncidents(
  input: HuntressPollInput
): Promise<HuntressPollResult> {
  const { tenantId, integrationId } = input;
  const { knex } = await createTenantKnex();

  const row = await knex('rmm_integrations')
    .where({ tenant: tenantId, integration_id: integrationId, provider: 'huntress' })
    .first();
  if (!row || !row.is_active) {
    return { success: false, skipped: 'integration_not_found', processed: 0, failed: 0 };
  }

  const settings = parseHuntressSettings(row.settings);
  if (!isRoutingConfigComplete(settings)) {
    // Not an error — setup is simply unfinished. The settings UI nags instead.
    return { success: true, skipped: 'routing_config_incomplete', processed: 0, failed: 0 };
  }

  const client = await createHuntressClient(tenantId);
  if (!client) {
    await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId })
      .update({
        sync_status: 'error',
        sync_error: 'Missing Huntress API credentials',
        updated_at: knex.fn.now(),
      });
    return {
      success: false,
      skipped: 'missing_credentials',
      processed: 0,
      failed: 0,
      error: 'Missing Huntress API credentials',
    };
  }

  await knex('rmm_integrations')
    .where({ tenant: tenantId, integration_id: integrationId })
    .update({ sync_status: 'syncing', updated_at: knex.fn.now() });

  let incidents;
  try {
    incidents = await collectIncidentsSince(
      async (pageToken) => {
        const page = await client.listIncidentReportsPage({ page_token: pageToken });
        return {
          incidents: page.incident_reports ?? [],
          nextPageToken: page.pagination?.next_page_token ?? undefined,
        };
      },
      { cursorIso: settings.incidentCursor ?? null, backfillDays: settings.backfillDays }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId })
      .update({ sync_status: 'error', sync_error: message, updated_at: knex.fn.now() });
    logger.error('[Huntress] Incident list failed', { tenantId, error: message });
    return { success: false, processed: 0, failed: 0, error: message };
  }

  const deps = {
    getAgent: (id: number) => client.getAgent(id),
    getOrganization: (id: number) => client.getOrganization(id),
  };

  let processed = 0;
  let cursor = settings.incidentCursor ?? null;
  let failure: string | undefined;

  for (const incident of incidents) {
    const result = await processIncident(
      knex,
      tenantId,
      { integration_id: integrationId, settings },
      incident,
      deps
    );
    if (!result.ok) {
      failure = result.error ?? 'Incident processing failed';
      break;
    }
    processed += 1;
    if (!cursor || Date.parse(incident.updated_at) > Date.parse(cursor)) {
      cursor = incident.updated_at;
    }
  }

  // Re-read settings before writing the cursor so config edits made while
  // the poll ran are not clobbered.
  const latest = await knex('rmm_integrations')
    .where({ tenant: tenantId, integration_id: integrationId })
    .first('settings');
  const merged = {
    ...parseHuntressSettings(latest?.settings ?? row.settings),
    incidentCursor: cursor ?? undefined,
  };

  await knex('rmm_integrations')
    .where({ tenant: tenantId, integration_id: integrationId })
    .update({
      settings: JSON.stringify(merged),
      sync_status: failure ? 'error' : 'completed',
      sync_error: failure ?? null,
      last_incremental_sync_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

  logger.info('[Huntress] Poll cycle finished', {
    tenantId,
    integrationId,
    trigger: input.trigger ?? 'scheduled',
    collected: incidents.length,
    processed,
    failed: failure ? 1 : 0,
  });

  return { success: !failure, processed, failed: failure ? 1 : 0, cursor, error: failure };
}

/**
 * Transport-wrapped entry point (HUNTRESS_SYNC_TRANSPORT → RMM_SYNC_TRANSPORT
 * → 'direct'). No Temporal workflow exists yet — leave the transport unset or
 * 'direct' until one is added.
 */
export async function runHuntressIncidentPoll(
  input: HuntressPollInput
): Promise<HuntressPollResult> {
  return runRmmSyncWithTransport<HuntressPollInput, HuntressPollResult>({
    context: { provider: 'huntress', operation: 'incident_poll', input },
    directExecutor: async (context) => pollHuntressIncidents(context.input),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress/incidentPoller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/incidents/incidentPoller.ts ee/server/src/__tests__/unit/huntress/incidentPoller.test.ts
git commit -m "feat(huntress): per-integration incident poll cycle"
```

---

### Task 11: Poll scheduling, CE stub, app wiring, module index

**Files:**
- Create: `ee/server/src/lib/integrations/huntress/scheduling.ts`
- Create: `ee/server/src/lib/integrations/huntress/index.ts`
- Create: `packages/ee/src/lib/integrations/huntress/scheduling.ts` (CE stub)
- Modify: `server/src/lib/initializeApp.ts` (end of the job-registration function, ~line 600)

pg-boss "recurring" jobs in this codebase are delayed one-shots with singleton dedup; the handler re-enqueues itself in `finally` (see the `createNextTimePeriods` handler in `server/src/lib/initializeApp.ts:478-584`). A single system-level dispatcher job ticks every 5 minutes and polls each due integration — connect/disconnect need no scheduling lifecycle of their own. The due-check (`isPollDue`) is already unit-tested in Task 2; the rest is glue verified by typecheck.

- [ ] **Step 1: Create `ee/server/src/lib/integrations/huntress/scheduling.ts`**

```typescript
/**
 * Huntress poll dispatcher: a single recurring pg-boss job that iterates all
 * active Huntress integrations and polls the ones whose per-tenant interval
 * has elapsed. Registered from initializeApp in enterprise builds.
 */

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { runWithTenant } from '@/lib/db';
import type { IJobScheduler } from 'server/src/lib/jobs/jobScheduler';
import { isPollDue, parseHuntressSettings } from './settings';
import { runHuntressIncidentPoll } from './incidents/incidentPoller';

export const HUNTRESS_POLL_JOB_NAME = 'huntress-incident-poll-dispatch';
const DISPATCH_INTERVAL = process.env.HUNTRESS_POLL_DISPATCH_INTERVAL || '5 minutes';

export async function dispatchHuntressPolls(now: Date = new Date()): Promise<void> {
  const knex = await getAdminConnection();
  const integrations = await knex('rmm_integrations')
    .where({ provider: 'huntress', is_active: true })
    .select('tenant', 'integration_id', 'settings', 'last_incremental_sync_at');

  for (const row of integrations) {
    const settings = parseHuntressSettings(row.settings);
    if (!isPollDue(row.last_incremental_sync_at, settings.pollIntervalMinutes, now)) continue;

    try {
      await runWithTenant(String(row.tenant), async () => {
        await runHuntressIncidentPoll({
          tenantId: String(row.tenant),
          integrationId: String(row.integration_id),
          trigger: 'scheduled',
        });
      });
    } catch (error) {
      // One tenant's failure must never block the others.
      logger.error('[Huntress] Scheduled poll failed', { tenant: row.tenant, error });
    }
  }
}

export async function registerHuntressPolling(jobScheduler: IJobScheduler): Promise<void> {
  jobScheduler.registerJobHandler<{ tenantId: string }>(HUNTRESS_POLL_JOB_NAME, async () => {
    try {
      await dispatchHuntressPolls();
    } finally {
      // Re-enqueue keeps the dispatcher ticking; singletonKey dedups retries.
      await jobScheduler.scheduleRecurringJob(HUNTRESS_POLL_JOB_NAME, DISPATCH_INTERVAL, {
        tenantId: 'system',
      });
    }
  });

  await jobScheduler.scheduleRecurringJob(HUNTRESS_POLL_JOB_NAME, DISPATCH_INTERVAL, {
    tenantId: 'system',
  });
  logger.info('[Huntress] Incident poll dispatcher registered');
}
```

- [ ] **Step 2: Create `ee/server/src/lib/integrations/huntress/index.ts`**

```typescript
export { HuntressClient, createHuntressClient } from './huntressClient';
export { parseHuntressSettings, isRoutingConfigComplete, prefillSeverityPriorityMap, isPollDue } from './settings';
export type { HuntressSettings } from './settings';
export { syncHuntressOrganizations } from './organizations/orgSync';
export { pollHuntressIncidents, runHuntressIncidentPoll } from './incidents/incidentPoller';
export { processIncident } from './incidents/incidentProcessor';
export { registerHuntressPolling, dispatchHuntressPolls, HUNTRESS_POLL_JOB_NAME } from './scheduling';
```

- [ ] **Step 3: Create the CE stub `packages/ee/src/lib/integrations/huntress/scheduling.ts`**

```typescript
/**
 * Community Edition stub. The Huntress integration is an Enterprise feature;
 * the EE build aliases @enterprise to ee/server/src where the real
 * implementation lives.
 */

export async function registerHuntressPolling(): Promise<void> {
  // no-op in CE builds
}
```

- [ ] **Step 4: Wire into `server/src/lib/initializeApp.ts`**

Find the end of the job-registration function — the per-tenant `createNextTimePeriods` scheduling loop:

```typescript
  for (const { tenant } of tenants) {
    try {
      await jobScheduler.scheduleRecurringJob(
        'createNextTimePeriods',
        '24 hours',
        { tenantId: tenant }
      );
    } catch (error) {
      logger.error(`Failed to schedule createNextTimePeriods job for tenant ${tenant}:`, error);
    }
  }
}
```

Insert the Huntress block before that closing brace:

```typescript
  for (const { tenant } of tenants) {
    try {
      await jobScheduler.scheduleRecurringJob(
        'createNextTimePeriods',
        '24 hours',
        { tenantId: tenant }
      );
    } catch (error) {
      logger.error(`Failed to schedule createNextTimePeriods job for tenant ${tenant}:`, error);
    }
  }

  // Huntress incident polling (Enterprise only). The @enterprise alias
  // resolves to the CE no-op stub in community builds.
  if (isEnterprise) {
    try {
      const { registerHuntressPolling } = await import(
        '@enterprise/lib/integrations/huntress/scheduling'
      );
      await registerHuntressPolling(jobScheduler);
    } catch (error) {
      logger.error('Failed to register Huntress incident polling:', error);
    }
  }
}
```

(`isEnterprise` is already imported at the top of the file from `./features`.)

- [ ] **Step 5: Typecheck both apps**

Run: `cd ee/server && npm run typecheck && cd ../../server && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors introduced by these files (compare against a pre-change run if the baseline is not clean).

- [ ] **Step 6: Commit**

```bash
git add ee/server/src/lib/integrations/huntress/scheduling.ts ee/server/src/lib/integrations/huntress/index.ts packages/ee/src/lib/integrations/huntress/scheduling.ts server/src/lib/initializeApp.ts
git commit -m "feat(huntress): recurring poll dispatcher wired into app startup"
```

---

### Task 12: Server actions

**Files:**
- Create: `ee/server/src/lib/actions/integrations/huntressActions.ts`

Thin glue over the tested modules — follows `ninjaoneActions.ts` conventions (`'use server'`, `withAuth` + tier gate HOF, `hasPermission` for writes). Tier gate is `TIER_FEATURES.INTEGRATIONS` (the integrations settings tab's feature), not `ADVANCED_ASSETS` — Huntress doesn't sync assets. No unit tests (repo precedent for action files); typecheck + the UI smoke task cover them.

- [ ] **Step 1: Create `ee/server/src/lib/actions/integrations/huntressActions.ts`**

```typescript
'use server';

/**
 * Huntress integration server actions: connect, status, routing settings,
 * organization mappings, and manual poll trigger.
 */

import { revalidatePath } from 'next/cache';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  HuntressClient,
  HUNTRESS_API_KEY_SECRET,
  HUNTRESS_API_SECRET_SECRET,
  HUNTRESS_DEFAULT_BASE_URL,
  createHuntressClient,
} from '../../integrations/huntress/huntressClient';
import {
  type HuntressSettings,
  type HuntressSeverityPriorityMap,
  isRoutingConfigComplete,
  parseHuntressSettings,
  prefillSeverityPriorityMap,
} from '../../integrations/huntress/settings';
import { syncHuntressOrganizations } from '../../integrations/huntress/organizations/orgSync';
import {
  pollHuntressIncidents,
  type HuntressPollResult,
} from '../../integrations/huntress/incidents/incidentPoller';
import type { RmmOrganizationMapping } from '../../../interfaces/rmm.interfaces';

const SETTINGS_PATH = '/msp/settings';

function withHuntressAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);
    return handler(user, context as { tenant: string }, ...args);
  });
}

async function requireSettingsUpdatePermission(user: unknown): Promise<void> {
  const allowed = await hasPermission(user, 'settings', 'update');
  if (!allowed) {
    throw new Error('You do not have permission to manage integrations');
  }
}

async function getIntegrationRow(knex: any, tenant: string) {
  return knex('rmm_integrations').where({ tenant, provider: 'huntress' }).first();
}

export interface HuntressConnectionStatus {
  is_connected: boolean;
  integration_id?: string;
  account_name?: string;
  account_subdomain?: string;
  sync_status?: string;
  sync_error?: string | null;
  last_poll_at?: string | null;
  routing_config_complete: boolean;
  settings: HuntressSettings | null;
  organization_count: number;
  unmapped_count: number;
  open_alert_count: number;
}

export const connectHuntress = withHuntressAccess(
  async (
    user,
    { tenant },
    input: { apiKey: string; apiSecret: string; baseUrl?: string }
  ): Promise<{ success: boolean; error?: string; accountName?: string }> => {
    await requireSettingsUpdatePermission(user);

    const apiKey = input.apiKey?.trim();
    const apiSecret = input.apiSecret?.trim();
    const baseUrl = input.baseUrl?.trim() || HUNTRESS_DEFAULT_BASE_URL;
    if (!apiKey || !apiSecret) {
      return { success: false, error: 'API key and secret are required' };
    }

    // Validate the credentials before storing anything.
    let account;
    try {
      account = await new HuntressClient({ apiKey, apiSecret, baseUrl }).getAccount();
    } catch (error) {
      logger.warn('[Huntress] Credential validation failed', { tenant, error });
      return {
        success: false,
        error: 'Could not authenticate with Huntress — check the API key and secret',
      };
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, HUNTRESS_API_KEY_SECRET, apiKey);
    await secretProvider.setTenantSecret(tenant, HUNTRESS_API_SECRET_SECRET, apiSecret);

    const { knex } = await createTenantKnex();
    const existing = await getIntegrationRow(knex, tenant);
    const existingSettings = parseHuntressSettings(existing?.settings);

    // Pre-fill severity → priority by name match when not already configured.
    let severityPriorityMap = existingSettings.severityPriorityMap;
    if (!severityPriorityMap.critical || !severityPriorityMap.high || !severityPriorityMap.low) {
      const priorities = await knex('priorities')
        .where({ tenant, item_type: 'ticket' })
        .select('priority_id', 'priority_name');
      severityPriorityMap = { ...prefillSeverityPriorityMap(priorities), ...severityPriorityMap };
    }

    const settings: HuntressSettings = {
      ...existingSettings,
      accountName: account.name,
      accountSubdomain: account.subdomain,
      severityPriorityMap,
    };

    let integrationId: string;
    if (existing) {
      integrationId = existing.integration_id;
      await knex('rmm_integrations')
        .where({ tenant, integration_id: integrationId })
        .update({
          instance_url: baseUrl,
          is_active: true,
          connected_at: knex.fn.now(),
          sync_status: 'pending',
          sync_error: null,
          settings: JSON.stringify(settings),
          updated_at: knex.fn.now(),
        });
    } else {
      const [inserted] = await knex('rmm_integrations')
        .insert({
          tenant,
          provider: 'huntress',
          instance_url: baseUrl,
          is_active: true,
          connected_at: knex.fn.now(),
          sync_status: 'pending',
          settings: JSON.stringify(settings),
        })
        .returning('integration_id');
      integrationId = (inserted as { integration_id: string }).integration_id;
    }

    // Initial org discovery is best-effort; the UI has a re-sync button.
    try {
      const client = new HuntressClient({ apiKey, apiSecret, baseUrl });
      await syncHuntressOrganizations(knex, tenant, integrationId, client);
    } catch (error) {
      logger.warn('[Huntress] Initial organization sync failed', { tenant, error });
    }

    revalidatePath(SETTINGS_PATH);
    return { success: true, accountName: account.name };
  }
);

export const getHuntressConnectionStatus = withHuntressAccess(
  async (_user, { tenant }): Promise<HuntressConnectionStatus> => {
    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);

    if (!row || !row.is_active) {
      return {
        is_connected: false,
        routing_config_complete: false,
        settings: null,
        organization_count: 0,
        unmapped_count: 0,
        open_alert_count: 0,
      };
    }

    const settings = parseHuntressSettings(row.settings);
    const [orgCount, unmappedCount, openAlertCount] = await Promise.all([
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: row.integration_id })
        .count('* as n')
        .first(),
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: row.integration_id })
        .whereNull('client_id')
        .count('* as n')
        .first(),
      knex('rmm_alerts')
        .where({ tenant, integration_id: row.integration_id })
        .whereIn('status', ['sent', 'auto_remediating'])
        .count('* as n')
        .first(),
    ]);

    return {
      is_connected: true,
      integration_id: row.integration_id,
      account_name: settings.accountName,
      account_subdomain: settings.accountSubdomain,
      sync_status: row.sync_status,
      sync_error: row.sync_error,
      last_poll_at: row.last_incremental_sync_at
        ? new Date(row.last_incremental_sync_at).toISOString()
        : null,
      routing_config_complete: isRoutingConfigComplete(settings),
      settings,
      organization_count: Number(orgCount?.n ?? 0),
      unmapped_count: Number(unmappedCount?.n ?? 0),
      open_alert_count: Number(openAlertCount?.n ?? 0),
    };
  }
);

export interface HuntressSettingsUpdate {
  boardId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  fallbackClientId?: string;
  fallbackBoardId?: string;
  severityPriorityMap?: HuntressSeverityPriorityMap;
  autoCloseTickets?: boolean;
  closedStatusId?: string | null;
  pollIntervalMinutes?: number;
  backfillDays?: number;
}

export const updateHuntressSettings = withHuntressAccess(
  async (
    user,
    { tenant },
    updates: HuntressSettingsUpdate
  ): Promise<{ success: boolean; error?: string; routing_config_complete?: boolean }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row) return { success: false, error: 'Huntress is not connected' };

    const current = parseHuntressSettings(row.settings);
    // Only routing/poll keys are user-editable; cursor and account identity
    // are owned by the poller and connect flow.
    const merged = parseHuntressSettings({
      ...current,
      ...(updates.boardId !== undefined ? { boardId: updates.boardId } : {}),
      ...(updates.categoryId !== undefined ? { categoryId: updates.categoryId } : {}),
      ...(updates.subcategoryId !== undefined ? { subcategoryId: updates.subcategoryId } : {}),
      ...(updates.fallbackClientId !== undefined
        ? { fallbackClientId: updates.fallbackClientId }
        : {}),
      ...(updates.fallbackBoardId !== undefined
        ? { fallbackBoardId: updates.fallbackBoardId }
        : {}),
      ...(updates.severityPriorityMap !== undefined
        ? { severityPriorityMap: { ...current.severityPriorityMap, ...updates.severityPriorityMap } }
        : {}),
      ...(updates.autoCloseTickets !== undefined
        ? { autoCloseTickets: updates.autoCloseTickets }
        : {}),
      ...(updates.closedStatusId !== undefined ? { closedStatusId: updates.closedStatusId } : {}),
      ...(updates.pollIntervalMinutes !== undefined
        ? { pollIntervalMinutes: updates.pollIntervalMinutes }
        : {}),
      ...(updates.backfillDays !== undefined ? { backfillDays: updates.backfillDays } : {}),
    });
    merged.incidentCursor = current.incidentCursor;

    await knex('rmm_integrations')
      .where({ tenant, integration_id: row.integration_id })
      .update({ settings: JSON.stringify(merged), updated_at: knex.fn.now() });

    revalidatePath(SETTINGS_PATH);
    return { success: true, routing_config_complete: isRoutingConfigComplete(merged) };
  }
);

export const disconnectHuntressIntegration = withHuntressAccess(
  async (user, { tenant }): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row) return { success: true };

    await knex('rmm_integrations')
      .where({ tenant, integration_id: row.integration_id })
      .update({ is_active: false, updated_at: knex.fn.now() });

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.deleteTenantSecret(tenant, HUNTRESS_API_KEY_SECRET);
    await secretProvider.deleteTenantSecret(tenant, HUNTRESS_API_SECRET_SECRET);

    revalidatePath(SETTINGS_PATH);
    return { success: true };
  }
);

export const syncHuntressOrganizationMappings = withHuntressAccess(
  async (
    user,
    { tenant }
  ): Promise<{ success: boolean; error?: string; created?: number; autoMatched?: number }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row || !row.is_active) return { success: false, error: 'Huntress is not connected' };

    const client = await createHuntressClient(tenant);
    if (!client) return { success: false, error: 'Huntress credentials are missing' };

    try {
      const result = await syncHuntressOrganizations(knex, tenant, row.integration_id, client);
      revalidatePath(SETTINGS_PATH);
      return { success: true, created: result.created, autoMatched: result.autoMatched };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[Huntress] Organization sync failed', { tenant, error: message });
      return { success: false, error: message };
    }
  }
);

export const getHuntressOrganizationMappings = withHuntressAccess(
  async (_user, { tenant }): Promise<RmmOrganizationMapping[]> => {
    const { knex } = await createTenantKnex();
    const rows = await knex('rmm_organization_mappings as rom')
      .join('rmm_integrations as ri', function (this: any) {
        this.on('ri.integration_id', '=', 'rom.integration_id').andOn(
          'ri.tenant',
          '=',
          'rom.tenant'
        );
      })
      .leftJoin('clients as c', function (this: any) {
        this.on('c.client_id', '=', 'rom.client_id').andOn('c.tenant', '=', 'rom.tenant');
      })
      .where('rom.tenant', tenant)
      .where('ri.provider', 'huntress')
      .select('rom.*', 'c.client_name as company_name')
      .orderBy('rom.external_organization_name', 'asc');
    return rows as RmmOrganizationMapping[];
  }
);

export const updateHuntressOrganizationMapping = withHuntressAccess(
  async (
    user,
    { tenant },
    mappingId: string,
    updates: { client_id?: string | null; auto_create_tickets?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const mapping = await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .first();
    if (!mapping) return { success: false, error: 'Mapping not found' };

    const changes: Record<string, unknown> = { updated_at: knex.fn.now() };
    if (updates.client_id !== undefined) {
      changes.client_id = updates.client_id;
      // A manual choice supersedes any auto-match flag.
      const metadata =
        typeof mapping.metadata === 'string'
          ? JSON.parse(mapping.metadata || '{}')
          : mapping.metadata ?? {};
      changes.metadata = JSON.stringify({ ...metadata, auto_matched: false });
    }
    if (updates.auto_create_tickets !== undefined) {
      changes.auto_create_tickets = updates.auto_create_tickets;
    }

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .update(changes);

    revalidatePath(SETTINGS_PATH);
    return { success: true };
  }
);

export const getHuntressRoutingOptions = withHuntressAccess(
  async (_user, { tenant }) => {
    const { knex } = await createTenantKnex();
    const [boards, priorities, categories, closedStatuses] = await Promise.all([
      knex('boards').where({ tenant }).select('board_id', 'board_name').orderBy('board_name'),
      knex('priorities')
        .where({ tenant, item_type: 'ticket' })
        .select('priority_id', 'priority_name')
        .orderBy('order_number'),
      knex('categories')
        .where({ tenant })
        .select('category_id', 'category_name', 'parent_category', 'board_id')
        .orderBy('category_name'),
      knex('statuses')
        .where({ tenant, item_type: 'ticket', is_closed: true })
        .select('status_id', 'name as status_name')
        .orderBy('order_number'),
    ]);
    return { boards, priorities, categories, closedStatuses };
  }
);

export const runHuntressPollNow = withHuntressAccess(
  async (user, { tenant }): Promise<HuntressPollResult & { error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row || !row.is_active) {
      return { success: false, processed: 0, failed: 0, error: 'Huntress is not connected' };
    }

    const result = await pollHuntressIncidents({
      tenantId: tenant,
      integrationId: row.integration_id,
      trigger: 'manual',
    });
    revalidatePath(SETTINGS_PATH);
    return result;
  }
);
```

- [ ] **Step 2: Typecheck**

Run: `cd ee/server && npm run typecheck`
Expected: no new errors. If `withAuth`'s handler typing rejects the `(user, context, ...args)` signature, mirror the exact generic usage from `ninjaoneActions.ts:80-87`.

- [ ] **Step 3: Commit**

```bash
git add ee/server/src/lib/actions/integrations/huntressActions.ts
git commit -m "feat(huntress): server actions for connect, settings, mappings, poll"
```

---

### Task 13: Provider registry "Security" category + setup page wiring

**Files:**
- Modify: `packages/integrations/src/lib/rmm/providerRegistry.ts`
- Modify: `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
- Create: `packages/ee/src/components/settings/integrations/HuntressIntegrationSettings.tsx` (CE stub)

- [ ] **Step 1: Extend the registry metadata**

In `packages/integrations/src/lib/rmm/providerRegistry.ts`:

1. Extend `RmmProviderMetadata` (lines 21-31) — change the `icon` union and add `category`:

```typescript
export interface RmmProviderMetadata {
  id: RmmProvider;
  title: string;
  description: string;
  icon: 'tacticalrmm' | 'ninjaone' | 'tanium' | 'huntress';
  badge?: RmmProviderBadge;
  highlights: RmmProviderHighlight[];
  capabilities: RmmProviderCapabilityFlags;
  requiresEnterprise: boolean;
  featureFlagKey?: 'tactical-rmm-integration' | 'tanium-rmm-integration';
  /** Card-grid grouping on the setup page. Defaults to 'rmm'. */
  category?: 'rmm' | 'security';
}
```

2. Append the Huntress entry to `RMM_PROVIDER_REGISTRY` (after the tanium entry, before the closing `];`):

```typescript
  {
    id: 'huntress',
    title: 'Huntress',
    description:
      'Managed security: SOC-reviewed incident reports become tickets automatically (Enterprise).',
    icon: 'huntress',
    badge: { label: 'Enterprise', variant: 'secondary' },
    highlights: [
      { label: 'Ingest', value: 'SOC incidents' },
      { label: 'Cadence', value: '5-min poll' }
    ],
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: false,
      events: false,
      remoteActions: false
    },
    requiresEnterprise: true,
    category: 'security'
  }
```

(The existing three entries keep no `category` field — they default to `'rmm'`.)

- [ ] **Step 2: Create the CE stub component**

Create `packages/ee/src/components/settings/integrations/HuntressIntegrationSettings.tsx`:

```typescript
'use client';

import React from 'react';

/**
 * Community Edition stub. Enterprise builds alias @enterprise to
 * ee/server/src, replacing this with the real settings component.
 */
export default function HuntressIntegrationSettings() {
  return (
    <div className="rounded-lg border p-6 text-center">
      <h3 className="text-base font-semibold">Huntress Integration</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        The Huntress security integration is an Enterprise feature.
      </p>
    </div>
  );
}
```

(Match the surrounding NinjaOne/Tanium stubs in that directory — if they use shared Card components, mirror their imports instead.)

- [ ] **Step 3: Wire the setup page**

In `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`:

1. Add a banner icon case inside `IntegrationBanner`'s `switch` (after the `'tanium'` case):

```typescript
      case 'huntress':
        return <BannerIcon className="bg-emerald-700 text-xl font-bold text-white">H</BannerIcon>;
```

2. Add a loading placeholder and dynamic import next to the Tanium ones (after the `TaniumIntegrationSettings` dynamic import):

```typescript
function HuntressLoading() {
  const { t } = useTranslation('msp/integrations');
  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="text-sm text-muted-foreground">
            {t('integrations.rmm.huntress.loading', {
              defaultValue: 'Loading Huntress integration settings...'
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const HuntressIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/HuntressIntegrationSettings'),
  {
    loading: () => <HuntressLoading />,
    ssr: false
  }
);
```

(Move `HuntressLoading` above the `dynamic()` call, alongside `NinjaOneLoading`/`TaniumLoading`.)

3. Register the component in `providerSettingsComponents` (line 119-123):

```typescript
const providerSettingsComponents: Partial<Record<RmmProvider, React.ComponentType>> = {
  tacticalrmm: TacticalRmmIntegrationSettings,
  ninjaone: NinjaOneIntegrationSettings,
  tanium: TaniumIntegrationSettings,
  huntress: HuntressIntegrationSettings
};
```

4. Render the card grid grouped by category. Inside the component, after `selectedOption` is computed, derive the groups:

```typescript
  const rmmOptions = options.filter((o) => (o.metadata.category ?? 'rmm') === 'rmm');
  const securityOptions = options.filter((o) => o.metadata.category === 'security');
```

Then replace the single grid block (the `<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">…</div>` that maps `options`) with a per-section render. Extract the existing card markup into a local helper so it is written once:

```typescript
  const renderCardGrid = (sectionOptions: RmmIntegrationOption[]) => (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
      {sectionOptions.map((option) => {
        const isSelected = option.metadata.id === selected;
        return (
          <Card
            key={option.metadata.id}
            className={[
              'relative overflow-hidden transition-shadow hover:shadow-md',
              isSelected ? 'ring-2 ring-[rgb(var(--color-primary-500))]' : '',
              'cursor-pointer'
            ].join(' ')}
            id={`rmm-integration-card-${option.metadata.id}`}
          >
            {/* ... keep the existing CardHeader / CardContent / CardFooter markup
                from the current options.map() body, unchanged ... */}
          </Card>
        );
      })}
    </div>
  );
```

and in the returned JSX:

```tsx
      {rmmOptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('integrations.rmm.setup.rmmSection', { defaultValue: 'Remote Monitoring & Management' })}
          </h3>
          {renderCardGrid(rmmOptions)}
        </div>
      )}

      {securityOptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('integrations.rmm.setup.securitySection', { defaultValue: 'Security' })}
          </h3>
          {renderCardGrid(securityOptions)}
        </div>
      )}
```

The "Active Configuration" block below stays as is — `selectedOption.component` now resolves Huntress too. The CE early-return (`!isEEAvailable`) also stays: Huntress is enterprise-only and is filtered out by the registry in CE.

- [ ] **Step 4: Typecheck + lint**

Run: `cd ee/server && npm run typecheck && npm run lint -- --file ../packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx 2>/dev/null || true`
Expected: typecheck clean; treat lint as advisory if the file pattern isn't supported.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/lib/rmm/providerRegistry.ts packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx packages/ee/src/components/settings/integrations/HuntressIntegrationSettings.tsx
git commit -m "feat(huntress): provider registry entry and Security section on setup page"
```

---

### Task 14: Huntress settings UI (EE)

**Files:**
- Create: `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx`

Follows `NinjaOneIntegrationSettings.tsx` conventions: client component, `@alga-psa/ui` primitives, server actions from Task 12, mapping manager embedded when connected (Task 15 builds it — add its import in that task's step; until then keep the placeholder comment shown below).

- [ ] **Step 1: Create the component**

Create `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { AlertCircle, CheckCircle, RefreshCw, ShieldAlert, Unlink } from 'lucide-react';
import {
  connectHuntress,
  disconnectHuntressIntegration,
  getHuntressConnectionStatus,
  getHuntressRoutingOptions,
  runHuntressPollNow,
  updateHuntressSettings,
  type HuntressConnectionStatus,
} from '../../../lib/actions/integrations/huntressActions';

type RoutingOptions = Awaited<ReturnType<typeof getHuntressRoutingOptions>>;

const HuntressIntegrationSettings: React.FC = () => {
  const [status, setStatus] = useState<HuntressConnectionStatus | null>(null);
  const [routingOptions, setRoutingOptions] = useState<RoutingOptions | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mappingRefreshKey, setMappingRefreshKey] = useState(0);

  // Connect form
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  // Routing form (initialized from status.settings)
  const [boardId, setBoardId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [fallbackClientId, setFallbackClientId] = useState<string | null>(null);
  const [fallbackBoardId, setFallbackBoardId] = useState<string | null>(null);
  const [priorityCritical, setPriorityCritical] = useState<string | null>(null);
  const [priorityHigh, setPriorityHigh] = useState<string | null>(null);
  const [priorityLow, setPriorityLow] = useState<string | null>(null);
  const [autoClose, setAutoClose] = useState(false);
  const [closedStatusId, setClosedStatusId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState('5');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, optionsResult, clientsResult] = await Promise.all([
        getHuntressConnectionStatus(),
        getHuntressRoutingOptions(),
        getAllClients(false),
      ]);
      setStatus(statusResult);
      setRoutingOptions(optionsResult);
      setClients(clientsResult ?? []);

      const s = statusResult.settings;
      if (s) {
        setBoardId(s.boardId ?? null);
        setCategoryId(s.categoryId ?? null);
        setFallbackClientId(s.fallbackClientId ?? null);
        setFallbackBoardId(s.fallbackBoardId ?? null);
        setPriorityCritical(s.severityPriorityMap.critical ?? null);
        setPriorityHigh(s.severityPriorityMap.high ?? null);
        setPriorityLow(s.severityPriorityMap.low ?? null);
        setAutoClose(s.autoCloseTickets);
        setClosedStatusId(s.closedStatusId ?? null);
        setPollInterval(String(s.pollIntervalMinutes));
      }
    } catch (error) {
      setMessage({ kind: 'error', text: 'Failed to load Huntress integration status' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleConnect = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await connectHuntress({ apiKey, apiSecret });
      if (result.success) {
        setApiKey('');
        setApiSecret('');
        setMessage({
          kind: 'success',
          text: `Connected to Huntress account "${result.accountName}". Complete the routing configuration below to start ticket creation.`,
        });
        await loadAll();
      } else {
        setMessage({ kind: 'error', text: result.error ?? 'Connection failed' });
      }
    });
  };

  const handleSaveRouting = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateHuntressSettings({
        boardId: boardId ?? undefined,
        categoryId,
        fallbackClientId: fallbackClientId ?? undefined,
        fallbackBoardId: fallbackBoardId ?? undefined,
        severityPriorityMap: {
          critical: priorityCritical ?? undefined,
          high: priorityHigh ?? undefined,
          low: priorityLow ?? undefined,
        },
        autoCloseTickets: autoClose,
        closedStatusId,
        pollIntervalMinutes: Number(pollInterval) || 5,
      });
      if (result.success) {
        setMessage({
          kind: 'success',
          text: result.routing_config_complete
            ? 'Routing configuration saved — incident polling is active.'
            : 'Saved, but routing is still incomplete; polling stays paused until every field below is set.',
        });
        await loadAll();
      } else {
        setMessage({ kind: 'error', text: result.error ?? 'Failed to save settings' });
      }
    });
  };

  const handlePollNow = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runHuntressPollNow();
      setMessage(
        result.success
          ? { kind: 'success', text: `Poll finished: ${result.processed} incident(s) processed.` }
          : { kind: 'error', text: result.error ?? 'Poll failed' }
      );
      await loadAll();
    });
  };

  const handleDisconnect = () => {
    if (!window.confirm('Disconnect Huntress? Existing tickets and mappings are kept.')) return;
    startTransition(async () => {
      await disconnectHuntressIntegration();
      setMessage({ kind: 'success', text: 'Huntress disconnected.' });
      await loadAll();
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading Huntress integration…
        </CardContent>
      </Card>
    );
  }

  const boardOptions =
    routingOptions?.boards.map((b: any) => ({ value: b.board_id, label: b.board_name })) ?? [];
  const priorityOptions =
    routingOptions?.priorities.map((p: any) => ({ value: p.priority_id, label: p.priority_name })) ??
    [];
  const categoryOptions = [
    { value: '', label: 'None' },
    ...(routingOptions?.categories
      .filter((c: any) => !boardId || c.board_id === boardId)
      .map((c: any) => ({ value: c.category_id, label: c.category_name })) ?? []),
  ];
  const closedStatusOptions =
    routingOptions?.closedStatuses.map((s: any) => ({ value: s.status_id, label: s.status_name })) ??
    [];

  return (
    <div className="space-y-6" id="huntress-integration-settings">
      {message && (
        <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {!status?.is_connected ? (
        <Card id="huntress-connect-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> Connect Huntress
            </CardTitle>
            <CardDescription>
              Generate API credentials at &lt;your-account&gt;.huntress.io → API Credentials, then
              paste them here. SOC-reviewed incident reports will become tickets automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              id="huntress-api-key"
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Input
              id="huntress-api-secret"
              type="password"
              placeholder="API Secret Key"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
            />
            <Button
              id="huntress-connect-button"
              onClick={handleConnect}
              disabled={isPending || !apiKey || !apiSecret}
            >
              {isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card id="huntress-status-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Connected to {status.account_name ?? 'Huntress'}
              </CardTitle>
              <CardDescription>
                {status.organization_count} organizations ({status.unmapped_count} unmapped) ·{' '}
                {status.open_alert_count} open incidents · last poll:{' '}
                {status.last_poll_at ? new Date(status.last_poll_at).toLocaleString() : 'never'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {status.sync_status === 'error' && status.sync_error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Last poll failed: {status.sync_error}</AlertDescription>
                </Alert>
              )}
              {!status.routing_config_complete && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Incident polling is paused until the routing configuration below is complete
                    (board, fallback client/board, and all three severity priorities).
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button
                  id="huntress-poll-now"
                  variant="outline"
                  onClick={handlePollNow}
                  disabled={isPending || !status.routing_config_complete}
                >
                  <RefreshCw className="mr-1 h-4 w-4" /> Poll now
                </Button>
                <Button
                  id="huntress-disconnect"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={isPending}
                >
                  <Unlink className="mr-1 h-4 w-4" /> Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card id="huntress-routing-card">
            <CardHeader>
              <CardTitle>Ticket Routing</CardTitle>
              <CardDescription>
                Where incident tickets land. Unmapped Huntress organizations always create tickets
                on the fallback client and triage board — nothing is dropped.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Security board</label>
                  <CustomSelect
                    options={boardOptions}
                    value={boardId}
                    onValueChange={setBoardId}
                    placeholder="Select board"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Category (optional)</label>
                  <CustomSelect
                    options={categoryOptions}
                    value={categoryId ?? ''}
                    onValueChange={(v) => setCategoryId(v || null)}
                    placeholder="None"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Fallback client</label>
                  <ClientPicker
                    id="huntress-fallback-client"
                    clients={clients}
                    selectedClientId={fallbackClientId}
                    onSelect={(id) => setFallbackClientId(id)}
                    filterState="active"
                    clientTypeFilter="all"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Fallback (triage) board</label>
                  <CustomSelect
                    options={boardOptions}
                    value={fallbackBoardId}
                    onValueChange={setFallbackBoardId}
                    placeholder="Select board"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Critical severity →</label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityCritical}
                    onValueChange={setPriorityCritical}
                    placeholder="Priority"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">High severity →</label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityHigh}
                    onValueChange={setPriorityHigh}
                    placeholder="Priority"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Low severity →</label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityLow}
                    onValueChange={setPriorityLow}
                    placeholder="Priority"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Poll interval (minutes)</label>
                  <Input
                    id="huntress-poll-interval"
                    type="number"
                    min={1}
                    max={60}
                    value={pollInterval}
                    onChange={(e) => setPollInterval(e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <input
                    id="huntress-auto-close"
                    type="checkbox"
                    checked={autoClose}
                    onChange={(e) => setAutoClose(e.target.checked)}
                  />
                  <label htmlFor="huntress-auto-close" className="text-sm">
                    Close tickets when Huntress closes the incident
                  </label>
                </div>
                {autoClose && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">Closed status</label>
                    <CustomSelect
                      options={closedStatusOptions}
                      value={closedStatusId}
                      onValueChange={setClosedStatusId}
                      placeholder="Select status"
                    />
                  </div>
                )}
              </div>

              <Button id="huntress-save-routing" onClick={handleSaveRouting} disabled={isPending}>
                {isPending ? 'Saving…' : 'Save routing configuration'}
              </Button>
            </CardContent>
          </Card>

          {/* Organization mapping manager is added in the next task:
              <HuntressOrganizationMappingManager refreshKey={mappingRefreshKey}
                onMappingChanged={() => { setMappingRefreshKey((k) => k + 1); void loadAll(); }} /> */}
        </>
      )}
    </div>
  );
};

export default HuntressIntegrationSettings;
```

- [ ] **Step 2: Typecheck**

Run: `cd ee/server && npm run typecheck`
Expected: clean. If `CustomSelect`'s `value` prop rejects `null`, pass `value={boardId ?? undefined}` (its prop type is `string | null | undefined` per `packages/ui/src/components/CustomSelect.tsx:41`).

- [ ] **Step 3: Commit**

```bash
git add ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx
git commit -m "feat(huntress): settings UI with connect and routing configuration"
```

---

### Task 15: Organization mapping manager UI (EE)

**Files:**
- Create: `ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx`
- Modify: `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx` (replace the placeholder comment)

- [ ] **Step 1: Create the mapping manager**

Create `ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx` (adapted from the NinjaOne `OrganizationMappingManager.tsx` in the sibling `ninjaone/` directory):

```tsx
'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { Building2, RefreshCw } from 'lucide-react';
import {
  getHuntressOrganizationMappings,
  syncHuntressOrganizationMappings,
  updateHuntressOrganizationMapping,
} from '../../../../lib/actions/integrations/huntressActions';
import type { RmmOrganizationMapping } from '../../../../interfaces/rmm.interfaces';

interface Props {
  refreshKey?: number;
  onMappingChanged?: () => void;
}

function isAutoMatched(mapping: RmmOrganizationMapping): boolean {
  const metadata =
    typeof mapping.metadata === 'string'
      ? (() => {
          try {
            return JSON.parse(mapping.metadata as unknown as string);
          } catch {
            return {};
          }
        })()
      : mapping.metadata ?? {};
  return (metadata as Record<string, unknown>).auto_matched === true;
}

const HuntressOrganizationMappingManager: React.FC<Props> = ({ refreshKey, onMappingChanged }) => {
  const [mappings, setMappings] = useState<RmmOrganizationMapping[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mappingsResult, clientsResult] = await Promise.all([
        getHuntressOrganizationMappings(),
        getAllClients(false),
      ]);
      setMappings(mappingsResult);
      setClients(clientsResult ?? []);
    } catch {
      setError('Failed to load organization mappings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncHuntressOrganizationMappings();
      if (!result.success) setError(result.error ?? 'Sync failed');
      await load();
      onMappingChanged?.();
    });
  };

  const handleClientChange = (mappingId: string, clientId: string | null) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, { client_id: clientId });
      if (!result.success) setError(result.error ?? 'Failed to update mapping');
      await load();
      onMappingChanged?.();
    });
  };

  const handleAutoCreateToggle = (mappingId: string, enabled: boolean) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        auto_create_tickets: enabled,
      });
      if (!result.success) setError(result.error ?? 'Failed to update mapping');
      await load();
      onMappingChanged?.();
    });
  };

  const unmappedCount = mappings.filter((m) => !m.client_id).length;

  return (
    <Card id="huntress-org-mappings">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Organization Mapping
            </CardTitle>
            <CardDescription>
              Map Huntress organizations to clients. Incidents for unmapped organizations go to the
              fallback client and triage board{unmappedCount > 0 ? ` (${unmappedCount} unmapped)` : ''}.
            </CardDescription>
          </div>
          <Button
            id="huntress-sync-orgs"
            variant="outline"
            onClick={handleSync}
            disabled={isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Sync organizations
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : mappings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No organizations yet — click "Sync organizations".
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Huntress Organization</th>
                <th className="py-2 pr-4 font-medium">Alga Client</th>
                <th className="py-2 pr-4 font-medium">Create Tickets</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.mapping_id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{mapping.external_organization_name}</td>
                  <td className="py-2 pr-4">
                    <ClientPicker
                      id={`huntress-client-picker-${mapping.mapping_id}`}
                      clients={clients}
                      selectedClientId={mapping.client_id ?? null}
                      onSelect={(clientId) => handleClientChange(mapping.mapping_id, clientId)}
                      filterState="active"
                      clientTypeFilter="all"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      id={`huntress-auto-create-${mapping.mapping_id}`}
                      type="checkbox"
                      checked={mapping.auto_create_tickets !== false}
                      onChange={(e) =>
                        handleAutoCreateToggle(mapping.mapping_id, e.target.checked)
                      }
                    />
                  </td>
                  <td className="py-2">
                    {mapping.client_id ? (
                      isAutoMatched(mapping) ? (
                        <Badge variant="secondary">Auto-matched</Badge>
                      ) : (
                        <Badge variant="default">Mapped</Badge>
                      )
                    ) : (
                      <Badge variant="outline">Unmapped → triage</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
};

export default HuntressOrganizationMappingManager;
```

- [ ] **Step 2: Embed it in the settings component**

In `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx`, add the import:

```typescript
import HuntressOrganizationMappingManager from './huntress/OrganizationMappingManager';
```

and replace the placeholder comment block (`{/* Organization mapping manager is added in the next task: ... */}`) with:

```tsx
          <HuntressOrganizationMappingManager
            refreshKey={mappingRefreshKey}
            onMappingChanged={() => {
              setMappingRefreshKey((k) => k + 1);
              void loadAll();
            }}
          />
```

- [ ] **Step 3: Typecheck**

Run: `cd ee/server && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx
git commit -m "feat(huntress): organization mapping manager UI"
```

---

### Task 16: Full verification + smoke checklist

**Files:** none new.

- [ ] **Step 1: Run the entire Huntress test suite**

Run: `cd ee/server && npx vitest run src/__tests__/unit/huntress src/__tests__/integration/huntressIncidentProcessor.integration.test.ts src/__tests__/integration/huntressOrgSync.integration.test.ts`
Expected: all PASS.

- [ ] **Step 2: Typecheck + lint both apps**

Run: `cd ee/server && npm run typecheck && npm run lint`
Expected: no new errors versus the pre-branch baseline.

- [ ] **Step 3: Confirm CE builds don't pull EE code**

Run: `grep -rn "integrations/huntress" server/src packages/integrations/src | grep -v "@enterprise"`
Expected: no output — the only CE-side references go through the `@enterprise` alias (stubbed in `packages/ee/src`).

- [ ] **Step 4: Manual smoke (dev stack, real or sandbox Huntress account)**

1. Start the dev environment (alga-dev-env-manager skill) with `NEXT_PUBLIC_EDITION=enterprise`.
2. Settings → Integrations → RMM & Security: the **Security** section shows the Huntress card.
3. Connect with real API credentials → account name appears; organizations list populates; exact-name orgs show "Auto-matched".
4. Configure routing (board, fallback client/board, three priorities) → the "polling paused" banner disappears.
5. Click **Poll now** → incidents within the backfill window appear as tickets on the security board with correct priority; open one ticket and verify the SOC summary, host details, and that the **portal deep link resolves** (if Huntress redirects, correct the path in `buildPortalUrl` — one function, one line).
6. Re-run **Poll now** → no duplicate tickets.
7. Unmap an org, create/find an incident for it → ticket lands on the fallback client + triage board with the `[Unmapped Org]` prefix.
8. Close an incident in Huntress (or wait for one to close), poll → internal note appended; with auto-close enabled, ticket moves to the closed status.

- [ ] **Step 5: Final commit (if any fixes were made)**

```bash
git add -A && git commit -m "fix(huntress): verification fixes"
```

---

## Self-review checklist (for the plan executor)

- Spec coverage: incident→ticket (Tasks 8, 10, 11), fail-safe org mapping + auto-match (Tasks 3, 8, 9, 15), routing config (Tasks 2, 12, 14), dedup/update-in-place (Tasks 6, 8), self-contained tickets + deep link (Task 5), polling + cursor + backfill (Tasks 4, 10), scheduling (Task 11), EE gating + Security section (Tasks 13–15).
- Deferred per spec (do NOT build): webhooks, write-back resolutions, escalations/signals, per-client routing overrides, Huntress asset-sync engine.
- Type names used across tasks: `HuntressSettings`, `HuntressSeverityPriorityMap`, `HuntressIncidentReport`, `HuntressPollInput/Result`, `IncidentAction`, `ProcessIncidentDeps` — defined once each in Tasks 1, 2, 6, 8, 10.












