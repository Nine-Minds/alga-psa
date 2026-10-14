import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source contract for the historical (created_at) branch of TicketService.addComment.
 * Behavior is covered by ticketHistoricalImport.integration.test.ts; this pins the
 * "silent" structure so a refactor cannot quietly re-attach a side effect.
 */
const source = fs.readFileSync(path.resolve(__dirname, '../../../lib/api/services/TicketService.ts'), 'utf8');
const start = source.indexOf('async addComment(');
const addComment = source.slice(start, source.indexOf('return result.response;', start));

describe('TicketService.addComment historical branch', () => {
  it('stamps comment and thread timestamps from created_at', () => {
    expect(addComment).toMatch(/isHistoricalComment = data\.created_at !== undefined/);
    expect(addComment).toMatch(/created_at: apiStampIso,\s*\n\s*updated_at: apiStampIso/);
  });

  it('never moves a thread last_activity_at backwards', () => {
    expect(addComment).toContain('GREATEST(last_activity_at, ?::timestamptz)');
  });

  it.each([
    ['applyCommentResponseState', /if \(!scheduledPublication && !isHistoricalComment\) \{\s*await applyCommentResponseState/],
    ['maybeReopenBundleMasterFromChildReply', /if \(isHistoricalComment\) \{[^}]*\} else if \(!comment\.is_internal && !scheduledPublication\) \{\s*await maybeReopenBundleMasterFromChildReply/],
    ['persistCommentPublication', /\} else if \(isHistoricalComment\) \{[^}]*\} else \{\s*await persistCommentPublication/],
  ])('skips %s for a historical comment', (_name, pattern) => {
    expect(addComment).toMatch(pattern);
  });

  it('rejects a created_at before the ticket entered_at or the parent comment', () => {
    expect(addComment).toMatch(/Date\.parse\(apiStampIso\) < new Date\(ticket\.entered_at\)/);
    expect(addComment).toMatch(/Date\.parse\(apiStampIso\) < new Date\(parent\.parent_created_at\)/);
  });

  it('still bumps tickets.updated_at', () => {
    expect(addComment).toMatch(/updated_by: context\.userId,\s*\n\s*updated_at: knex\.raw\('now\(\)'\)/);
  });
});
