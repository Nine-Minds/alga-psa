import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'invoiceJobActions.ts'), 'utf8');

describe('invoice email brand logo contract', () => {
  it('routes invoice mail through TenantEmailService and preserves attachments', () => {
    expect(source).toContain("import { StaticTemplateProcessor, TenantEmailService } from '@alga-psa/email'");
    expect(source).toContain("mailClass: 'billing'");
    expect(source).toContain('TenantEmailService.getInstance(tenant).sendEmail({');
    expect(source).toContain('templateProcessor: new StaticTemplateProcessor(subject, html, text)');
    expect(source).toContain("contentType: 'application/pdf'");
    expect(source).not.toContain('SystemEmailProviderFactory');
  });

  it('delegates branded logo handling to the shared email engine', () => {
    expect(source).not.toContain('embedBrandLogo(');
    expect(source).toContain('templateProcessor: new StaticTemplateProcessor(subject, html, text)');
  });
});
