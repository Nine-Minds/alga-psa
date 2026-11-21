import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { replaceTemplateVariables } from './EmailTemplatePreview';
import { getTemplateVariableToken } from './TemplateVariableReference';
import { annotateHtmlSource } from './emailTemplateSourceMap';
import { expandEachBlocksForPreview, expandIfBlocksForPreview, getSampleDataForPreview, replaceTemplateSampleVariables } from '../../lib/templateSampleData';
import { getNestedTemplateExampleData, templateVariableRegistry } from '../../lib/templateVariables';

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
  it('shows the same sample values for every added ticket detail field', () => {
    const variables = templateVariableRegistry['ticket-closed'].variables;
    const sample = getSampleDataForPreview('ticket-closed', '');
    const nestedSample = getNestedTemplateExampleData('ticket-closed');
    const arrays = ['ticket.assets', 'ticket.materials', 'ticket.timeEntries'];
    const totals = new Set([
      'ticket.materialsTotal',
      'ticket.totalTimeWorked',
      'ticket.totalTimeBillable',
      'ticket.remainingBlockHours',
    ]);

    for (const variable of variables) {
      const array = arrays.find((path) => variable.path.startsWith(`${path}[].`));
      if (!array && !totals.has(variable.path)) continue;

      const token = getTemplateVariableToken(variable);
      const template = array ? `{{#each ${array}}}${token}{{/each}}` : token;
      expect(replaceTemplateVariables(template, sample), variable.path).toBe(variable.example);
      expect(Handlebars.compile(template, { strict: true })(nestedSample), variable.path).toBe(variable.example);
    }
  });

  it('previews both documented ticket examples with their actual sample rows', () => {
    const guide = readFileSync(path.resolve(here, '../../../../../docs/email/editing-ticket-email-html.md'), 'utf8');
    const examples = [...guide.matchAll(/```html\r?\n([\s\S]*?)```/g)].map(match => match[1]);
    expect(examples).toHaveLength(2);

    for (const [index, source] of examples.entries()) {
      const sample = getSampleDataForPreview('ticket-closed', source);
      const rendered = replaceTemplateVariables(annotateHtmlSource(source), sample);
      expect(rendered).not.toContain('{{');
      expect(rendered).toContain(sample['ticket.title']);
      expect(rendered).toContain(sample['ticket.materialsTotal']);
      expect(rendered).toContain(sample['ticket.totalTimeWorked']);
      expect(rendered).toContain(sample['ticket.totalTimeBillable']);
      expect(rendered).toContain(sample['ticket.remainingBlockHours']);

      const rows = [...rendered.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/g)].map(match => {
        expect(match[1].match(/<tr\b/g)).toHaveLength(1);
        return [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
      });
      const fields = (array: string, names: string[]) => names.map(name => sample[`ticket.${array}[].${name}`]);
      // The examples render the billed flag through {{#if billed}}Yes{{else}}No{{/if}}.
      const materialCells = (names: string[]) => names.map(name => (name === 'billed' ? 'Yes' : sample[`ticket.materials[].${name}`]));

      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual(index === 0
        ? fields('assets', ['assetTag', 'name', 'assetType', 'manufacturer', 'model', 'serialNumber', 'status', 'location', 'relationship'])
        : [
            ...fields('assets', ['name', 'assetType']),
            `${sample['ticket.assets[].manufacturer']} ${sample['ticket.assets[].model']}`,
            sample['ticket.assets[].serialNumber'],
          ]);
      expect(rows[1]).toEqual(materialCells(index === 0
        ? ['name', 'description', 'quantity', 'rate', 'amount', 'currencyCode', 'billed']
        : ['name', 'quantity', 'amount', 'billed']));
      expect(rows[2]).toEqual(fields('timeEntries', index === 0
        ? ['date', 'technician', 'worked', 'billable']
        : ['date', 'technician', 'billable']));
    }
  });

  it('previews closed-ticket array columns using bare and this-qualified field names', () => {
    const data = getSampleDataForPreview('ticket-closed', '');
    const rendered = replaceTemplateVariables(
      '{{#if ticket.timeEntries}}<table>{{#each ticket.timeEntries}}<tr><td>{{date}}</td><td>{{this.technician}}</td><td>{{worked}}</td><td>{{this.billable}}</td></tr>{{/each}}</table>{{/if}}',
      data,
    );
    expect(rendered).not.toContain('{{');
    for (const value of ['06/10/2025', 'Jane Smith', '1 hr, 30 min', '1 hr']) {
      expect(rendered).toContain(`<td>${value}</td>`);
    }
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

  it('preserves qualified item paths containing hyphens and bracketed names', () => {
    const rendered = replaceTemplateVariables(
      '{{#each items}}{{this.customer-id }} {{this.[display-name]}}{{/each}}',
      { 'items.customer-id': 'A-1', 'items.[display-name]': 'Printer' },
    );
    expect(rendered).toBe('A-1 Printer');
  });

  it('drops {{#unless @first}} blocks, since the preview shows only the first item', () => {
    const html = replaceTemplateVariables(
      '{{#each ticket.changeItems}}<div style="margin:0;{{#unless @first}}margin-top:14px;{{/unless}}">{{this.label}}</div>{{/each}}',
      { 'ticket.changeItems.label': 'Status' },
    );
    expect(html).toBe('<div style="margin:0;">Status</div>');
  });

  it('leaves non-each content untouched', () => {
    const rendered = replaceTemplateVariables('Hello {{user.name}}!', { 'user.name': 'Dorothy' });

    expect(rendered).toBe('Hello Dorothy!');
  });

  it('shows the if branch and drops the else branch in preview', () => {
    const rendered = replaceTemplateVariables(
      '<td>{{#if billed}}Yes{{else}}No{{/if}}</td>',
      { billed: 'true' },
    );

    expect(rendered).toBe('<td>Yes</td>');
  });

  it('shares array qualification and nested conditional expansion with test emails', () => {
    const data = {
      'ticket.title': 'Printer',
      'ticket.materials[].name': 'Toner',
      'ticket.materials[].billed': 'true',
    };
    const source = '{{#if ticket.materials}}<ul>{{#each ticket.materials}}<li>{{name}} {{this.name}} {{ticket.title}} {{#if billed}}Yes{{else}}No{{/if}}</li>{{/each}}</ul>{{/if}}';
    const expanded = expandEachBlocksForPreview(source, data);
    expect(expanded).toContain('{{ticket.materials[].name}}');
    expect(expanded).toContain('{{ticket.title}}');
    expect(expandIfBlocksForPreview(expanded, () => true))
      .toBe('<ul><li>{{ticket.materials[].name}} {{ticket.materials[].name}} {{ticket.title}} Yes</li></ul>');
    expect(expandIfBlocksForPreview('{{#if missing}}Yes{{else}}No{{/if}}', () => false)).toBe('No');
  });

  it('renders the same array values and conditional branches for HTML and text test mail', () => {
    const data = {
      'ticket.materials': 'one row',
      'ticket.materials[].name': 'Toner',
      'ticket.materials[].billed': 'true',
      'ticket.title': 'Printer',
    };
    const hasSampleData = (condition: string) => Object.hasOwn(data, condition);
    const source = '{{#if ticket.materials}}{{#each ticket.materials}}{{#unless @first}}, {{/unless}}{{name}} {{{this.name}}} {{ticket.title}} {{#if missing}}No{{else if billed}}Yes{{else}}Unknown{{/if}}{{/each}}{{/if}}';
    expect(replaceTemplateSampleVariables(source, data, hasSampleData)).toBe('Toner Toner Printer Yes');
    expect(replaceTemplateSampleVariables('{{#if missing}}A{{else if absent}}B{{else}}C{{/if}}', data, hasSampleData)).toBe('C');
  });
});
