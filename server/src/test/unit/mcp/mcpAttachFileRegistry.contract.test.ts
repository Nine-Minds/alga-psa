import { describe, expect, it, vi } from 'vitest';

/**
 * Registry contract for attach-file discoverability: a search for attaching a
 * file to a ticket must rank the JSON `POST /api/v1/documents` entry above the
 * multipart-only ticket upload entry, and the multipart entry must steer
 * callers to attach_file / POST /api/v1/documents.
 */
vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => false }));

import { loadMcpRegistry } from '@/lib/mcp/loadRegistry';
import { runRegistrySearch } from '@alga-psa/agent-tooling';

describe('attach-file registry contract', () => {
  it('ranks POST /api/v1/documents above the multipart ticket upload', async () => {
    const { entries } = await loadMcpRegistry();
    const r = runRegistrySearch(entries, { query: 'attach a file to a ticket' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const results = (r.data as any).results as Array<{ entryId: string; method: string; path: string }>;
    const docs = results.findIndex((e) => e.method.toLowerCase() === 'post' && e.path === '/api/v1/documents');
    const multipart = results.findIndex((e) => e.method.toLowerCase() === 'post' && e.path === '/api/v1/tickets/{id}/documents');
    expect(docs).toBeGreaterThanOrEqual(0);
    if (multipart >= 0) expect(docs).toBeLessThan(multipart);
  });

  it('multipart entry says multipart only and points at attach_file', async () => {
    const { entries } = await loadMcpRegistry();
    const entry = entries.find((e) => e.method.toLowerCase() === 'post' && e.path === '/api/v1/tickets/{id}/documents');
    expect(entry).toBeDefined();
    expect(entry!.description ?? '').toMatch(/multipart/i);
    expect(entry!.description ?? '').toMatch(/attach_file/);
    expect(entry!.description ?? '').toMatch(/POST \/api\/v1\/documents/);
  });

  it('documents entry leads with the URL path and carries two examples', async () => {
    const { entries } = await loadMcpRegistry();
    const entry = entries.find((e) => e.method.toLowerCase() === 'post' && e.path === '/api/v1/documents')!;
    const d = entry.description ?? '';
    expect(d.indexOf('url')).toBeGreaterThanOrEqual(0);
    expect(d.indexOf('url')).toBeLessThan(d.indexOf('base64'));
    expect(d).toMatch(/one file per call/i);
    expect((entry as any).examples).toHaveLength(2);
    expect(d).toMatch(/allowed download hosts/i);
    expect(d).toMatch(/FETCH_HOST_NOT_ALLOWED/);
  });
});
