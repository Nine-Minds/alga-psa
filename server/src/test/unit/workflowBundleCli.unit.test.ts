import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('workflow bundle CLI', () => {
  it('exports a workflow to a bundle file via the API', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-workflow-bundle-'));
    const out = path.join(tmpDir, 'bundle.json');
    const workflowId = '00000000-0000-0000-0000-000000000999';

    const body = '{\"format\":\"alga-psa.workflow-bundle\",\"formatVersion\":1,\"exportedAt\":\"2000-01-01T00:00:00.000Z\",\"workflows\":[]}\n';

    const fetchImpl = async (url, opts) => {
      expect(String(url)).toBe(`http://example.com/api/workflow-definitions/${workflowId}/export`);
      expect(opts?.method).toBe('GET');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const logs: string[] = [];
    const consoleImpl = { log: (msg: string) => logs.push(String(msg)), error: () => {} };

    const mod: any = await import('../../../../tools/workflow-bundle-cli/workflow-bundle.js');
    await mod.runWorkflowBundleCli(
      ['export', '--base-url', 'http://example.com', '--workflow-id', workflowId, '--out', out],
      { fetchImpl, fsImpl: fs, consoleImpl }
    );

    expect(fs.readFileSync(out, 'utf8')).toBe(body);
    expect(logs.join('\n')).toContain('Wrote');
  });
});

