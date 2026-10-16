import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectStatusUpdateActions.ts'), 'utf8');

describe('project status update brand logo contract', () => {
  it('routes through TenantEmailService so BaseEmailService handles branded logos', () => {
    expect(source).toContain("import { StaticTemplateProcessor, TenantEmailService, resolveTenantCompanyName } from '@alga-psa/email'");
    expect(source).toContain("mailClass: 'project'");
    expect(source).toContain('TenantEmailService.getInstance(tenant).sendEmail({');
    expect(source).toContain('templateProcessor: new StaticTemplateProcessor(subject, html, text)');
    expect(source).not.toContain('SystemEmailProviderFactory');
  });

  it('delegates logo embedding to the shared email engine', () => {
    expect(source).not.toContain('embedBrandLogo(');
    expect(source).toContain('templateProcessor: new StaticTemplateProcessor(subject, html, text)');
  });
});
