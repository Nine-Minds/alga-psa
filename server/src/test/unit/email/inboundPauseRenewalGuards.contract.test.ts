import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('paused inbound provider renewal guards', () => {
  it('T031/T033: Microsoft renewal, probes, and silence detection share the paused-provider exclusion', () => {
    const source = read('shared/services/email/EmailWebhookMaintenanceService.ts');

    expect(source).toContain(
      ".andWhere('ep.is_active', true)\n      .whereNull('ep.inbound_paused_at')"
    );
    expect(source).toContain('return await this.probeSubscription(adapter, config)');
    expect(source).toContain('detectWebhookSilence');
  });

  it('T032: Gmail watch renewal excludes paused providers', () => {
    const source = read('packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler.ts');

    expect(source).toContain(
      ".andWhere('ep.is_active', true)\n    .whereNull('ep.inbound_paused_at')"
    );
  });

  it('T015/T016: Gmail webhook services wire cleanup to the real adapter stop call', () => {
    for (const servicePath of [
      'server/src/services/email/GmailWebhookService.ts',
      'packages/integrations/src/services/email/GmailWebhookService.ts',
    ]) {
      const source = read(servicePath);
      expect(source).toContain('await adapter.stopWatch()');
      expect(source).not.toContain('TODO: Implement actual Gmail watch stop');
    }
  });
});
