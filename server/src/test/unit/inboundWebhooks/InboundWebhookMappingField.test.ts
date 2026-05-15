import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInboundWebhookMappingFieldOptions } from '@/components/settings/security/inbound/InboundWebhookMappingField';

const mappingFieldSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/security/inbound/InboundWebhookMappingField.tsx'),
  'utf8',
);

describe('InboundWebhookMappingField autocomplete options', () => {
  it('T123: builds mapping field options from captured webhook payload paths', () => {
    const options = buildInboundWebhookMappingFieldOptions({
      alert: {
        id: 'alert-1',
        severity: 'critical',
      },
      device: {
        hostname: 'server-01',
      },
    });

    expect(options).toEqual([
      { value: 'alert', label: 'alert', dropdownHint: 'object' },
      { value: 'alert.id', label: 'alert.id', dropdownHint: 'string' },
      { value: 'alert.severity', label: 'alert.severity', dropdownHint: 'string' },
      { value: 'device', label: 'device', dropdownHint: 'object' },
      { value: 'device.hostname', label: 'device.hostname', dropdownHint: 'string' },
    ]);
  });

  it('uses CE-safe shared UI components for inbound webhook mappings', () => {
    expect(mappingFieldSource).toContain("import { TextArea } from '@alga-psa/ui/components/TextArea'");
    expect(mappingFieldSource).not.toContain('ee/server');
    expect(mappingFieldSource).not.toContain('workflow-designer');
  });
});
