import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { replaceTemplateVariables } from './EmailTemplatePreview';
import { getSampleDataForPreview } from '../../lib/templateSampleData';
import { getTemplateVariableToken } from './TemplateVariableReference';
import { templateVariableRegistry } from '../../lib/templateVariables';

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
  it('previews selectable ticket asset fields and inserts usable loop tokens', () => {
    const variables = templateVariableRegistry['ticket-closed'].variables;
    const array = variables.find((variable) => variable.path === 'ticket.assets')!;
    const name = variables.find((variable) => variable.path === 'ticket.assets[].name')!;
    expect(getTemplateVariableToken(name)).toBe('{{this.name}}');
    expect(getTemplateVariableToken(array)).toBe(array.example);
    const data = getSampleDataForPreview('ticket-closed', array.example, '');
    const html = replaceTemplateVariables(array.example, data);
    expect(html).toContain('Office Printer');
    expect(html).toContain('Brother HL-L6200DW');
    expect(html).toContain('SN-0042');
    expect(html).toContain('<table');
    expect(html.match(/<th /g)).toHaveLength(4);
    expect(html.match(/<td /g)).toHaveLength(4);
    expect(html).not.toContain('{{');
    expect(html).not.toContain('AST-0042');
    expect(replaceTemplateVariables('{{#each ticket.assets}}{{this.assetTag}}{{/each}}', data)).toBe('AST-0042');
  });

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

  it('handles a guarded asset section and hides missing optional row fields', () => {
    const rendered = replaceTemplateVariables(
      '{{#if ticket.assets}}<h2>Devices</h2>{{#each ticket.assets}}<div>{{name}}{{#if serialNumber}} Serial: {{serialNumber}}{{/if}}</div>{{/each}}{{/if}}',
      { 'ticket.assets': 'sample list', 'ticket.assets[].name': 'Printer', 'ticket.assets[].serialNumber': '' },
    );
    expect(rendered).toBe('<h2>Devices</h2><div>Printer</div>');
  });

  it('leaves non-each content untouched', () => {
    const rendered = replaceTemplateVariables('Hello {{user.name}}!', { 'user.name': 'Dorothy' });

    expect(rendered).toBe('Hello Dorothy!');
  });
});
