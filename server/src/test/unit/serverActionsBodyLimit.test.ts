import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_ACTIONS_BODY_LIMIT, SERVER_ACTION_ENVELOPE_BYTES, parseByteSize } from '@alga-psa/storage/ingest/bufferedCap';
import { KB_IMPORT_MAX_TOTAL_BYTES } from '@alga-psa/documents/lib/kbImportLimits';
import { CO_MANAGED_ATTACHMENT_MAX_BYTES } from '../../lib/co-managed/attachmentUploadLimit';

const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');
const defaultBytes = parseByteSize(DEFAULT_SERVER_ACTIONS_BODY_LIMIT)!;

// Measured worst legitimate non-file action body: a BlockNote doc at the 1,000,000-char cap, 3.65 MB
// (7.1 MB with every character a quote, double-encoded). See the comment in next.config.mjs.
const MEASURED_WORST_NON_FILE_BODY_BYTES = 7.1 * 1000 * 1000;

describe('SERVER_ACTIONS_BODY_LIMIT default', () => {
  it('is the same in next.config.mjs, next.config.minimal.mjs and helm (deployment + values)', () => {
    for (const file of ['server/next.config.mjs', 'server/next.config.minimal.mjs']) {
      expect(new RegExp(`SERVER_ACTIONS_BODY_LIMIT \\|\\| '${DEFAULT_SERVER_ACTIONS_BODY_LIMIT}'`).test(read(file))).toBe(true);
    }
    expect(read('helm/templates/deployment.yaml')).toContain(`serverActionsBodyLimit | default "${DEFAULT_SERVER_ACTIONS_BODY_LIMIT}"`);
    expect(read('helm/values.yaml')).toContain(`serverActionsBodyLimit: "${DEFAULT_SERVER_ACTIONS_BODY_LIMIT}"`);
  });

  it('covers the largest measured non-file body, with headroom', () => {
    expect(defaultBytes).toBeGreaterThan(MEASURED_WORST_NON_FILE_BODY_BYTES);
  });

  it('still carries the buffered file actions that stay on server actions', () => {
    expect(defaultBytes).toBeGreaterThanOrEqual(CO_MANAGED_ATTACHMENT_MAX_BYTES + SERVER_ACTION_ENVELOPE_BYTES);
    // KB import escapes its text inside the payload: worst case 2x the raw total.
    expect(defaultBytes).toBeGreaterThanOrEqual(KB_IMPORT_MAX_TOTAL_BYTES * 2 + SERVER_ACTION_ENVELOPE_BYTES);
  });

  it('is minimal: not above the co-managed attachment floor rounded up to a whole MiB', () => {
    expect(defaultBytes).toBeLessThanOrEqual(CO_MANAGED_ATTACHMENT_MAX_BYTES + 1024 * 1024);
  });
});
