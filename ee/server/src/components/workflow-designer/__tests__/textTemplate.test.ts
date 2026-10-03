import { describe, expect, it } from 'vitest';

import {
  compileTextTemplate,
  parseTextTemplate,
  textTemplateFromValue,
} from '../mapping/textTemplate';
import { insertTextTemplateField } from '../mapping/WorkflowTextTemplateEditor';
import { buildWorkflowSampleContext } from '../mapping/sampleContext';
import { evaluateExpressionPreview } from '../expression-editor/ExpressionPreview';
import { getAutoGrowEditorHeight } from '../expression-editor/ExpressionEditorField';
import { validateExpressionSource } from '@alga-psa/workflows/authoring';

describe('text with fields', () => {
  const template = 'Contract ending: {{vars.client.client.client_name}} on {{payload.endDate}}.';

  it('splits text and workflow fields, leaving other {{names}} as text', () => {
    expect(parseTextTemplate('Hi {{name}}, see {{ payload.ticket.title }}')).toEqual([
      { kind: 'text', text: 'Hi {{name}}, see ' },
      { kind: 'field', path: 'payload.ticket.title' },
    ]);
  });

  it('saves text without fields as plain text and text with fields as a joined expression', () => {
    expect(compileTextTemplate('Hello {{name}}')).toBe('Hello {{name}}');
    const compiled = compileTextTemplate(template) as { $expr: string };
    expect(compiled.$expr).toBe('"Contract ending: " & vars.client.client.client_name & " on " & payload.endDate & "."');
    expect(() => validateExpressionSource(compiled.$expr)).not.toThrow();
  });

  it('reads saved values back into the same text', () => {
    expect(textTemplateFromValue(compileTextTemplate(template))).toBe(template);
    expect(textTemplateFromValue('Plain "quoted" text')).toBe('Plain "quoted" text');
    expect(textTemplateFromValue(compileTextTemplate('Line 1\nLine "2": {{vars.x.items[-1].note}}'))).toBe(
      'Line 1\nLine "2": {{vars.x.items[-1].note}}'
    );
    expect(textTemplateFromValue(undefined)).toBe('');
  });

  it('leaves real expressions to the Expression editor', () => {
    expect(textTemplateFromValue({ $expr: 'payload.count > 1 ? "many" : "one"' })).toBeNull();
    // A quoted literal is just text.
    expect(textTemplateFromValue({ $expr: '"literal only"' })).toBe('literal only');
    expect(textTemplateFromValue({ $expr: 'toString(payload.count) & " items"' })).toBeNull();
    expect(textTemplateFromValue('Looks like {{payload.x}}')).toBeNull();
  });

  it('inserts a field at the caret and completes a started placeholder', () => {
    expect(insertTextTemplateField('Hi ', 3, 3, 'payload.name')).toEqual({ text: 'Hi {{payload.name}}', caret: 19 });
    expect(insertTextTemplateField('Hi {{payload.na', 15, 15, 'payload.name')).toEqual({ text: 'Hi {{payload.name}}', caret: 19 });
    expect(insertTextTemplateField('Hi {{', 5, 5, 'payload.name').text).toBe('Hi {{payload.name}}');
  });
});

describe('expression preview with sample data', () => {
  const sample = buildWorkflowSampleContext({
    payload: [{ name: 'endDate', path: 'payload.endDate', type: 'string', source: 'payload' }],
    vars: [{
      stepId: 's',
      stepName: 'Find Client',
      saveAs: 'client',
      fields: [{
        name: 'client',
        path: 'vars.client.client',
        type: 'object',
        source: 'vars',
        children: [
          { name: 'client_name', path: 'vars.client.client.client_name', type: 'string', source: 'vars' },
          { name: 'is_inactive', path: 'vars.client.client.is_inactive', type: 'boolean', source: 'vars' },
        ],
      }],
    }],
    meta: [],
    error: [],
  });

  it('fills fields with placeholders named after them', () => {
    expect(sample).toEqual({
      payload: { endDate: '[end date]' },
      vars: { client: { client: { client_name: '[client name]', is_inactive: true } } },
      meta: {},
    });
  });

  it('evaluates expressions and reports errors in plain words', async () => {
    const compiled = compileTextTemplate('Contract ending: {{vars.client.client.client_name}} on {{payload.endDate}}') as { $expr: string };
    await expect(evaluateExpressionPreview(compiled.$expr, sample as unknown as Record<string, unknown>)).resolves.toEqual({
      status: 'ok',
      text: 'Contract ending: [client name] on [end date]',
    });
    await expect(evaluateExpressionPreview('', {})).resolves.toEqual({ status: 'empty' });
    const broken = await evaluateExpressionPreview('payload.endDate &', sample as unknown as Record<string, unknown>);
    expect(broken.status).toBe('error');
  });

  it('grows the inline editor with its content, up to a cap', () => {
    expect(getAutoGrowEditorHeight('a', 96)).toBe(96);
    expect(getAutoGrowEditorHeight(Array(8).fill('line').join('\n'), 96)).toBe(24 + 8 * 18);
    expect(getAutoGrowEditorHeight(Array(100).fill('line').join('\n'), 96)).toBe(320);
  });
});

describe('preview inside a loop', () => {
  it('uses the first item of the loop list', async () => {
    const sample = buildWorkflowSampleContext({
      payload: [],
      vars: [],
      meta: [],
      error: [],
      forEach: { itemVar: 'checklistItem', indexVar: 'index', itemsExpr: '["Welcome call", "Set up portal"]' },
    });
    const compiled = compileTextTemplate('TODO: {{checklistItem}} (#{{index}})', { localNames: ['checklistItem', 'index'] }) as { $expr: string };
    await expect(evaluateExpressionPreview(compiled.$expr, sample as unknown as Record<string, unknown>)).resolves.toEqual({
      status: 'ok',
      text: 'TODO: Welcome call (#0)',
    });
  });

  it('falls back to a placeholder item when the list cannot be evaluated', async () => {
    const sample = buildWorkflowSampleContext({
      payload: [],
      vars: [],
      meta: [],
      error: [],
      forEach: { itemVar: 'checklistItem', indexVar: 'index', itemsExpr: 'payload.missing' },
    });
    await expect(evaluateExpressionPreview('checklistItem', sample as unknown as Record<string, unknown>)).resolves.toEqual({
      status: 'ok',
      text: '[checklist item]',
    });
  });
});
