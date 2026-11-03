import { describe, expect, it } from 'vitest';
import validator from '@rjsf/validator-ajv8';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Form from '@rjsf/core';
import type { RJSFSchema } from '@rjsf/utils';

const schema: RJSFSchema = {
  type: 'object',
  properties: { summary: { type: 'string', title: 'Summary' } },
  required: ['summary'],
  additionalProperties: { type: 'string' },
};

describe('workspace RJSF compatibility', () => {
  it('initializes the validator and validates schema data', () => {
    expect(validator.validateFormData({ summary: 'Ticket' }, schema).errors).toEqual([]);
    expect(validator.validateFormData({}, schema).errors).toEqual([
      expect.objectContaining({ name: 'required' }),
    ]);
  });

  it('renders a form with additional properties using the same utils and validator', () => {
    const html = renderToStaticMarkup(createElement(Form, {
      schema, validator, formData: { summary: 'Ticket', extra: 'Additional value' },
    }));
    expect(html).toContain('Additional value');
    expect(html).toContain('Summary');
  });
});
