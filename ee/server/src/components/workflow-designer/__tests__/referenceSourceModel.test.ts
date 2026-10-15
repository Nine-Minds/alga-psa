import { describe, expect, it } from 'vitest';

import { buildReferenceSourceModel, extractPrimaryPath } from '../workflowReferenceSelector';
import { isSimpleFieldReferenceExpression } from '../WorkflowActionInputSourceMode';

const context = {
  payload: [],
  meta: [],
  error: [],
  vars: [
    {
      stepId: 'find',
      stepName: 'Find Ticket',
      saveAs: 'ticketDetails',
      fields: [
        {
          name: 'comments',
          path: 'vars.ticketDetails.comments',
          type: 'array',
          source: 'vars' as const,
          children: [
            { name: 'note', path: 'vars.ticketDetails.comments.note', type: 'string', source: 'vars' as const },
            { name: 'author_type', path: 'vars.ticketDetails.comments.author_type', type: 'string', source: 'vars' as const },
          ],
        },
      ],
    },
  ],
};

describe('reference source model', () => {
  const model = buildReferenceSourceModel(
    context,
    [{ value: 'vars.ticketDetails', label: 'vars.ticketDetails' }],
    undefined,
    { firstItem: '(first item)', lastItem: '(last item)', wholeResult: 'Entire result' }
  );
  const fields = model.vars.find((step) => step.value === 'ticketDetails')?.fields ?? [];
  const byValue = new Map(fields.map((field) => [field.value, field]));

  it('offers the first and last record of a list directly', () => {
    expect(byValue.get('vars.ticketDetails.comments[0].note')).toMatchObject({ label: 'comments[0].note (first item)', type: 'string' });
    expect(byValue.get('vars.ticketDetails.comments[-1].note')).toMatchObject({ label: 'comments[-1].note (last item)', type: 'string' });
  });

  it('labels the bare step path as the entire result, not a field', () => {
    expect(byValue.get('vars.ticketDetails')).toMatchObject({ label: 'Entire result', type: 'object' });
  });

  it('treats indexed paths as plain references and reads them back whole', () => {
    expect(isSimpleFieldReferenceExpression('vars.ticketDetails.comments[-1].note')).toBe(true);
    expect(isSimpleFieldReferenceExpression('vars.ticketDetails.comments[0].note')).toBe(true);
    expect(extractPrimaryPath('vars.ticketDetails.comments[-1].note')).toBe('vars.ticketDetails.comments[-1].note');
    expect(extractPrimaryPath('"Reply: " & vars.ticketDetails.comments[0].note')).toBe('vars.ticketDetails.comments[0].note');
  });
});
