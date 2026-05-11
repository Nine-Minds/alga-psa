import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminWebhooksSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/security/AdminWebhooksSetup.tsx'),
  'utf8',
);

describe('AdminWebhooksSetup inbound UI contract', () => {
  it('T130: renders a tabbed webhooks settings shell with inbound and outbound tabs', () => {
    expect(adminWebhooksSource).toContain('<Tabs value={activeTab}');
    expect(adminWebhooksSource).toContain('<TabsList className="mb-6">');
    expect(adminWebhooksSource).toContain('<TabsTrigger id="webhooks-inbound-tab" value="inbound">');
    expect(adminWebhooksSource).toContain('<TabsTrigger id="webhooks-outbound-tab" value="outbound">');
    expect(adminWebhooksSource).toContain('<TabsContent value="inbound">');
    expect(adminWebhooksSource).toContain('<TabsContent value="outbound">');
    expect(adminWebhooksSource).toContain('<InboundWebhooksListView />');
    expect(adminWebhooksSource).toContain('<OutboundWebhooksSetup />');
  });
});
