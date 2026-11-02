import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { replaceTemplateVariables } from '@alga-psa/email/lib/replaceTemplateVariables';

// Lives in server for the same Nx-graph reason as clientPortalTenantRecoveryEmail.test.ts.
const require = createRequire(import.meta.url);

type Translation = { language: string; subject: string; htmlContent: string; textContent: string };
type Template = { translations: Translation[] };

const msp = require('../../../migrations/utils/templates/email/auth/mspTenantRecovery.cjs') as {
  getTemplate: () => Template;
};
const client = require('../../../migrations/utils/templates/email/auth/tenantRecovery.cjs') as {
  getTemplate: () => Template;
};

describe('msp-tenant-recovery template', () => {
  const mspTranslations = msp.getTemplate().translations;

  it('ships exactly the same language set as the client-portal recovery template', () => {
    const langs = (t: Translation[]) => t.map((x) => x.language).sort();
    expect(langs(mspTranslations)).toEqual(langs(client.getTemplate().translations));
  });

  it('never calls the destination the client portal', () => {
    for (const t of mspTranslations) {
      const all = `${t.subject}\n${t.htmlContent}\n${t.textContent}`.toLowerCase();
      expect(all).not.toContain('client portal');
    }
  });

  it('renders the multi-organization and single-organization branches without leaking handlebars', () => {
    const en = mspTranslations.find((t) => t.language === 'en')!;
    for (const isMultiple of [true, false]) {
      const vars = {
        platformName: 'AlgaPSA',
        currentYear: 2026,
        tenantCount: isMultiple ? 2 : 1,
        tenantLinksHtml: '<tr><td>Acme MSP</td></tr>',
        tenantLinksText: '1. Acme MSP',
        isMultiple,
      };
      for (const raw of [en.subject, en.htmlContent, en.textContent]) {
        const out = replaceTemplateVariables(raw, vars);
        for (const literal of ['{{else}}', '{{#if', '{{/if}}']) expect(out).not.toContain(literal);
      }
    }
  });
});
