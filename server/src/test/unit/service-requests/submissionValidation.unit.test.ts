import { describe, expect, it } from 'vitest';
import { validateSubmissionAgainstPublishedSchema } from '../../../lib/service-requests/submissionService';

const schema = {
  fields: [
    { key: 'intro', type: 'callout', label: 'Read me first', required: true },
    { key: 'employee', type: 'section', label: 'Employee' },
    { key: 'full_name', type: 'short-text', label: 'Full name', required: true },
    { key: 'quantity', type: 'number', label: 'Quantity', validation: { min: 1, max: 50 } },
    { key: 'contact_email', type: 'email', label: 'Contact email' },
    {
      key: 'summary',
      type: 'long-text',
      label: 'Summary',
      validation: { minLength: 20, message: 'Tell us a little more.' },
    },
    { key: 'start_date', type: 'date', label: 'Start date', validation: { minDate: '2026-01-01' } },
    { key: 'policy', type: 'file-upload', label: 'Signed policy', required: true },
  ],
};

describe('validateSubmissionAgainstPublishedSchema', () => {
  it('passes a complete submission and never asks a display block for an answer', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: schema,
        payload: {
          full_name: 'Maya Lindqvist',
          quantity: '2',
          contact_email: 'maya@example.com',
          summary: 'A standard desk setup with a second monitor.',
          start_date: '2026-03-02',
        },
        attachments: [{ fieldKey: 'policy', fileId: 'file-1' }],
      })
    ).toEqual([]);
  });

  it('keeps the historic wording for a missing required answer and a missing file', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: schema,
        payload: {},
      })
    ).toEqual([
      'Required field missing: "Full name"',
      'Required file upload missing for "Signed policy"',
    ]);
  });

  it('enforces the new rules server-side, custom message and all', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: schema,
        payload: {
          full_name: 'Maya',
          quantity: '99',
          contact_email: 'not-an-address',
          summary: 'Too short',
          start_date: '2025-12-31',
        },
        attachments: [{ fieldKey: 'policy', fileId: 'file-1' }],
      })
    ).toEqual([
      '"Quantity" must be 50 or less',
      '"Contact email" is not in the expected format',
      '"Summary": Tell us a little more.',
      '"Start date" must be on or after 2026-01-01',
    ]);
  });

  it('skips a hidden field entirely, required or not', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: schema,
        payload: {},
        attachments: [],
        visibleFieldKeys: ['quantity'],
      })
    ).toEqual([]);
  });

  it('lets a blank optional answer through every rule', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: schema,
        payload: { full_name: 'Maya', quantity: '', contact_email: '', summary: '' },
        attachments: [{ fieldKey: 'policy', fileId: 'file-1' }],
      })
    ).toEqual([]);
  });

  it('counts an unchecked required checkbox as answered, matching the browser', () => {
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: { fields: [{ key: 'agree', type: 'checkbox', label: 'Agree', required: true }] },
        payload: { agree: false },
      })
    ).toEqual([]);
  });

  it('checks how many choices a multi-select carries', () => {
    const multiSchema = {
      fields: [
        {
          key: 'peripherals',
          type: 'multi-select',
          label: 'Peripherals',
          validation: { maxSelected: 2 },
        },
      ],
    };
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: multiSchema,
        payload: { peripherals: ['dock', 'headset', 'monitor'] },
      })
    ).toEqual(['"Peripherals" allows at most 2 selected']);
    expect(
      validateSubmissionAgainstPublishedSchema({
        formSchema: multiSchema,
        payload: { peripherals: ['dock'] },
      })
    ).toEqual([]);
  });
});
