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
