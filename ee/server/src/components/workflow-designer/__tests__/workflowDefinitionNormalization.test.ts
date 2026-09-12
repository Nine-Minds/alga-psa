import { describe, expect, it } from 'vitest';
import type { Step } from '@alga-psa/workflows/runtime';

import { normalizeWorkflowDefinitionSteps, stripEmptyActionInputExpressions } from '../workflowDefinitionNormalization';

const emailStep = (inputMapping: Record<string, unknown>): Step => ({
  id: 'send',
  type: 'action.call',
  config: { actionId: 'email.send', version: 1, inputMapping },
});

describe('stripEmptyActionInputExpressions', () => {
  it('drops untouched reference/expression fields but keeps real values', () => {
    const [step] = stripEmptyActionInputExpressions([
      emailStep({
        to: [{ email: 'a@b.c' }],
        subject: { $expr: 'payload.title' },
        html: { $expr: '' },
        text: { $expr: '   ' },
        from: { $secret: 'FROM' },
      }),
    ]);
    expect((step as { config: { inputMapping: Record<string, unknown> } }).config.inputMapping).toEqual({
      to: [{ email: 'a@b.c' }],
      subject: { $expr: 'payload.title' },
      from: { $secret: 'FROM' },
    });
  });

  it('recurses into control blocks', () => {
    const steps: Step[] = [
      {
        id: 'if',
        type: 'control.if',
        condition: { $expr: 'true' },
        then: [emailStep({ html: { $expr: '' } })],
        else: [{ id: 'fe', type: 'control.forEach', items: { $expr: 'payload.items' }, itemVar: 'item', body: [emailStep({ html: { $expr: '' } })] }],
      },
      { id: 'tc', type: 'control.tryCatch', try: [emailStep({ html: { $expr: '' } })], catch: [] },
    ];
    const json = JSON.stringify(stripEmptyActionInputExpressions(steps));
    expect(json).not.toContain('"$expr":""');
    expect(json).toContain('"$expr":"true"');
  });

  it('keeps the control-block fields the definition schema requires', () => {
    const steps: Step[] = [
      {
        id: 'if',
        type: 'control.if',
        condition: { $expr: 'payload.flag' },
        then: [emailStep({ html: { $expr: '' } })],
        else: [{ id: 'fe', type: 'control.forEach', items: { $expr: 'payload.items' }, itemVar: 'item', concurrency: 2, body: [] }],
      },
      { id: 'tc', type: 'control.tryCatch', try: [], catch: [emailStep({ html: { $expr: '' } })] },
    ];
    const [ifBlock, tryCatch] = stripEmptyActionInputExpressions(steps);
    expect(ifBlock).toMatchObject({ id: 'if', type: 'control.if', condition: { $expr: 'payload.flag' } });
    expect((ifBlock as { else: Step[] }).else[0]).toMatchObject({ items: { $expr: 'payload.items' }, itemVar: 'item', concurrency: 2 });
    expect(tryCatch).toMatchObject({ id: 'tc', type: 'control.tryCatch', try: [] });
    expect(Array.isArray((tryCatch as { catch: Step[] }).catch)).toBe(true);
  });

  it('tolerates control blocks whose branches are missing', () => {
    const steps = [
      { id: 'if', type: 'control.if', condition: { $expr: 'payload.flag' } },
      { id: 'fe', type: 'control.forEach', items: { $expr: 'payload.items' }, itemVar: 'item' },
      { id: 'tc', type: 'control.tryCatch' },
    ] as never as Step[];
    const [ifBlock, forEach, tryCatch] = stripEmptyActionInputExpressions(steps);
    expect(ifBlock).toMatchObject({ id: 'if', type: 'control.if', condition: { $expr: 'payload.flag' } });
    expect(forEach).toMatchObject({ id: 'fe', itemVar: 'item' });
    expect(tryCatch).toMatchObject({ id: 'tc', type: 'control.tryCatch' });
  });

  it('leaves steps without a mapping untouched and tolerates missing steps', () => {
    const step: Step = { id: 'ret', type: 'control.return' };
    expect(stripEmptyActionInputExpressions([step])[0]).toBe(step);
    const definition = { id: 'wf', version: 1, name: 'x', payloadSchemaRef: 'p', steps: undefined } as never;
    expect(normalizeWorkflowDefinitionSteps(definition)).toBe(definition);
  });
});
