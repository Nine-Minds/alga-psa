// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DnsRecordInstructions from '@ee/components/settings/email/DnsRecordInstructions';

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/email-providers');
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const codeValues = () => Array.from(document.querySelectorAll('code')).map((node) => node.textContent);

describe('DnsRecordInstructions host labels', () => {
  it('uses the provider-supplied host for subdomains and hints at the parent zone', () => {
    render(
      <DnsRecordInstructions
        domain="e.resxtech.com"
        records={[{ type: 'MX', name: 'send.e.resxtech.com', host: 'send.e', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }]}
      />
    );

    expect(codeValues()).toEqual(['send.e', 'send.e.resxtech.com', 'feedback-smtp.us-east-1.amazonses.com']);
    const hint = screen.getByText(/resxtech\.com/, { selector: 'p' }).textContent ?? '';
    expect(hint).toContain('“resxtech.com”');
    expect(hint).not.toContain('e.resxtech.com');
  });

  it('falls back to stripping the registered domain for records without a host', () => {
    render(
      <DnsRecordInstructions
        domain="example.com"
        records={[
          { type: 'TXT', name: 'send.example.com', value: 'v=spf1' },
          { type: 'TXT', name: 'example.com', value: 'v=DMARC1' },
        ]}
      />
    );

    expect(codeValues()).toEqual(['send', 'send.example.com', 'v=spf1', '@', 'example.com', 'v=DMARC1']);
  });
});
