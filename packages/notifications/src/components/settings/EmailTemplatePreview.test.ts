import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { replaceTemplateVariables } from './EmailTemplatePreview';
import { getSampleDataForPreview } from '../../lib/templateSampleData';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, '../../../../..', 'server/migrations/utils/templates/email');

function loadTemplate(relative: string, language = 'en'): { subject: string; html: string } {
  const loaded = require(path.join(templatesRoot, relative)) as { getTemplate: () => any };
  const definition = loaded.getTemplate();
  const translation = definition.translations.find((entry: any) => entry.language === language);
  return { subject: translation.subject, html: translation.htmlContent };
}

describe('replaceTemplateVariables #each handling', () => {
  it('renders the credit-expiring table rows from the registry examples', () => {
    const { subject, html } = loadTemplate('billing/creditExpiration.cjs');
    const data = getSampleDataForPreview('credit-expiring', html, subject);
    const rendered = replaceTemplateVariables(html, data);

    expect(rendered).not.toContain('{{#each');
    expect(rendered).not.toContain('{{/each}}');
    expect(rendered).not.toContain('{{this.');
    expect(rendered).toContain('CR-1001');
    expect(rendered).toContain('TX-9001');
  });

  it('expands {{#if this.*}} inside an each block', () => {
    const rendered = replaceTemplateVariables(
      '{{#each recent.items}}<li>{{this.name}}{{#if this.completedOn}} — {{this.completedOn}}{{/if}}</li>{{/each}}',
      { 'recent.items.name': 'Kickoff', 'recent.items.completedOn': 'May 1' },
    );

    expect(rendered).toBe('<li>Kickoff — May 1</li>');
  });

  it('leaves non-each content untouched', () => {
    const rendered = replaceTemplateVariables('Hello {{user.name}}!', { 'user.name': 'Dorothy' });

    expect(rendered).toBe('Hello Dorothy!');
  });
});
