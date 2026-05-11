import { describe, expect, it } from 'vitest';
import { buildInboundWebhookMappingFieldOptions } from '@/components/settings/security/inbound/InboundWebhookMappingField';

describe('InboundWebhookMappingField autocomplete options', () => {
  it('T123: builds ExpressionTextArea field options from captured webhook payload paths', () => {
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
});
