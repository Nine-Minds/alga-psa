import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { replaceTemplateVariables } from '../lib/replaceTemplateVariables';

const require = createRequire(import.meta.url);

type TenantRecoveryTranslation = {
  language: string;
  subject: string;
  htmlContent: string;
  textContent: string;
};

const { getTemplate } = require(
  path.resolve(__dirname, '../../../../server/migrations/utils/templates/email/auth/tenantRecovery.cjs')
) as { getTemplate: () => { translations: TenantRecoveryTranslation[] } };

const en = getTemplate().translations.find((translation) => translation.language === 'en')!;

function render(isMultiple: boolean) {
  const variables = {
    platformName: 'AlgaPSA',
    currentYear: 2026,
    tenantCount: isMultiple ? 2 : 1,
    tenantLinksHtml: '<tr><td>Nine Minds LLC</td></tr>',
    tenantLinksText: '1. Nine Minds LLC',
    isMultiple,
  };

  return {
    subject: replaceTemplateVariables(en.subject, variables),
    html: replaceTemplateVariables(en.htmlContent, variables),
    text: replaceTemplateVariables(en.textContent, variables),
  };
}

const HANDLEBARS_LITERALS = ['{{else}}', '{{#if', '{{/if}}'];

describe('tenant recovery template rendering', () => {
  it('renders the single-organization branch from {{else}} instead of leaking it', () => {
    const { subject, html, text } = render(false);

    expect(html).toContain('Here is your login link:');
    expect(text).toContain('Here is your login link:');
    expect(html).not.toContain('We found');
    expect(text).not.toContain('We found');
    // The bug Tinus received: "{{else}}Here is your login link:" sent verbatim.
    for (const literal of HANDLEBARS_LITERALS) {
      expect(subject).not.toContain(literal);
      expect(html).not.toContain(literal);
      expect(text).not.toContain(literal);
    }
  });

  it('renders the multiple-organization branch with the tenant count', () => {
    const { subject, html, text } = render(true);

    expect(html).toContain('We found 2 organizations associated with your email address.');
    expect(text).toContain('We found 2 organizations associated with your email address.');
    expect(html).toContain('client portals.');
    expect(html).not.toContain('Here is your login link:');
    expect(text).not.toContain('Here is your login link:');
    for (const literal of HANDLEBARS_LITERALS) {
      expect(subject).not.toContain(literal);
      expect(html).not.toContain(literal);
      expect(text).not.toContain(literal);
    }
  });

  it('keeps every localized translation free of unrendered conditionals', () => {
    for (const translation of getTemplate().translations) {
      for (const isMultiple of [true, false]) {
        const variables = {
          platformName: 'AlgaPSA',
          currentYear: 2026,
          tenantCount: isMultiple ? 3 : 1,
          tenantLinksHtml: '<tr><td>Nine Minds LLC</td></tr>',
          tenantLinksText: '1. Nine Minds LLC',
          isMultiple,
        };

        for (const field of [translation.subject, translation.htmlContent, translation.textContent]) {
          const rendered = replaceTemplateVariables(field, variables);
          for (const literal of HANDLEBARS_LITERALS) {
            expect(rendered, `${translation.language} isMultiple=${isMultiple}`).not.toContain(literal);
          }
        }
      }
    }
  });
});
