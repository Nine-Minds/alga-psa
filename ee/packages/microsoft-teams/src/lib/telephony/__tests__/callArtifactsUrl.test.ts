import { describe, expect, it } from 'vitest';
import { buildAdhocGetAllUrl } from '../callArtifacts';

const base = 'https://graph.microsoft.com/v1.0';

describe('buildAdhocGetAllUrl', () => {
  it('builds the documented getAll function URL with a window from the call start', () => {
    const url = buildAdhocGetAllUrl({
      graphBaseUrl: base,
      organizerUserId: 'org-1',
      kind: 'recordings',
      startedAt: '2026-08-25T10:00:00.000Z',
      now: new Date('2026-08-25T12:00:00.000Z'),
    });
    expect(url).toBe(
      `${base}/users/org-1/adhocCalls/getAllRecordings(userId=org-1,startDateTime=2026-08-25T09:55:00.000Z,endDateTime=2026-08-25T12:00:00.000Z)`
    );
  });

  it('omits the window when the call start is unknown', () => {
    const url = buildAdhocGetAllUrl({ graphBaseUrl: base, organizerUserId: 'org-1', kind: 'transcripts' });
    expect(url).toBe(`${base}/users/org-1/adhocCalls/getAllTranscripts(userId=org-1)`);
  });

  it('never emits a per-call list path (the fictitious endpoint)', () => {
    const url = buildAdhocGetAllUrl({ graphBaseUrl: base, organizerUserId: 'org-1', kind: 'recordings' });
    expect(url).not.toMatch(/adhocCalls\/[^g][^/]*\/recordings/);
  });
});
