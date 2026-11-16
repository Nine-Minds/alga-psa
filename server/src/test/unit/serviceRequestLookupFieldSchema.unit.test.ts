import { describe, expect, it } from 'vitest';
import {
  normalizeBasicFormSchema,
  resolveStaticDefaultValues,
  validateBasicFormSchema,
} from '../../lib/service-requests/basicFormBuilder';
import { renderServiceRequestTemplate } from '../../lib/service-requests/ticketTextTemplate';
import { buildTicketDescription } from '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider';
import { getSubmissionFieldDisplay } from '../../app/client-portal/request-services/submissionFieldPresentation';

const lookup = (extra: Record<string, unknown> = {}) => ({
  key: 'manager',
  type: 'lookup',
  label: 'Manager',
  lookup: { entity: 'contact', scope: 'requester-client' },
  ...extra,
});

describe('unknown field types', () => {
  it('normalizer preserves an unknown type instead of coercing it to short-text', () => {
    const { fields } = normalizeBasicFormSchema({ fields: [{ key: 'a', type: 'rating', label: 'Rating' }] });
    expect(fields[0].type).toBe('rating');
  });

  it('validation rejects it with the field label and position (the check is no longer dead)', () => {
    const result = validateBasicFormSchema({ fields: [{ key: 'a', type: 'rating', label: 'Rating' }] });
    expect(result.isValid).toBe(false);
    expect(result.errors.join('\n')).toContain('Field #1 ("Rating") has unsupported type "rating"');
  });

  it('a missing type is rejected too, not defaulted', () => {
    expect(validateBasicFormSchema({ fields: [{ key: 'a', label: 'A' }] }).isValid).toBe(false);
  });

  it('static defaults skip an unknown type rather than treating it as text', () => {
    expect(
      resolveStaticDefaultValues({ fields: [{ key: 'a', type: 'rating', label: 'A', defaultValue: 'x' }] })
    ).toEqual({});
  });
});

describe('lookup field schema validation', () => {
  it('accepts a contact lookup and defaults scope from the entity', () => {
    expect(validateBasicFormSchema({ fields: [lookup()] }).isValid).toBe(true);
    const { fields } = normalizeBasicFormSchema({
      fields: [{ key: 'm', type: 'lookup', label: 'M', lookup: { entity: 'contact' } }],
    });
    expect(fields[0].lookup).toEqual({ entity: 'contact', scope: 'requester-client' });
  });

  it('requires an entity', () => {
    for (const bad of [{ lookup: undefined }, { lookup: {} }, { lookup: { scope: 'tenant' } }]) {
      const result = validateBasicFormSchema({ fields: [lookup(bad)] });
      expect(result.errors.join('\n')).toContain('requires an entity');
    }
  });

  it('rejects an unknown entity', () => {
    const result = validateBasicFormSchema({ fields: [lookup({ lookup: { entity: 'asset' } })] });
    expect(result.errors.join('\n')).toContain('unsupported lookup entity "asset"');
  });

  it('refuses static options and a default value', () => {
    const withOptions = validateBasicFormSchema({
      fields: [lookup({ options: [{ label: 'A', value: 'a' }] })],
    });
    expect(withOptions.errors.join('\n')).toContain('cannot have static options');
    const withDefault = validateBasicFormSchema({ fields: [lookup({ defaultValue: 'abc' })] });
    expect(withDefault.errors.join('\n')).toContain('cannot have a default value');
  });

  it('never allows contacts to be scoped to the whole tenant', () => {
    const result = validateBasicFormSchema({ fields: [lookup({ lookup: { entity: 'contact', scope: 'tenant' } })] });
    expect(result.errors.join('\n')).toContain('cannot use scope "tenant"');
  });

  it('filters must be allowlisted scalars', () => {
    expect(
      validateBasicFormSchema({ fields: [lookup({ lookup: { entity: 'contact', filters: { role: 'Manager' } } })] }).isValid
    ).toBe(true);
    const bad = validateBasicFormSchema({
      fields: [lookup({ lookup: { entity: 'contact', filters: { role: { $ne: 1 }, password: 'x' } } })],
    });
    expect(bad.errors.join('\n')).toContain('"role" must be a string or boolean');
    expect(bad.errors.join('\n')).toContain('"password" is not supported');
  });
});

describe('lookup answers render as labels, never ids', () => {
  const schema = { fields: [lookup()] };
  const format = { locale: 'en', yes: 'Yes', no: 'No' };
  const id = '3f7c0000-0000-4000-8000-000000000001';

  it('template placeholder uses the label snapshot, falling back to the id only if the entity is gone', () => {
    expect(
      renderServiceRequestTemplate('{{manager}}', { formSchema: schema, payload: { manager: id }, format, lookupLabels: { manager: 'Jane Doe' } })
    ).toBe('Jane Doe');
    expect(renderServiceRequestTemplate('{{manager}}', { formSchema: schema, payload: { manager: id }, format })).toBe(id);
  });

  it('ticket description row uses the label', () => {
    const description = buildTicketDescription(
      { formSchema: schema, payload: { manager: id }, format, lookupLabels: { manager: 'Jane Doe' } },
      {}
    );
    expect(description).toContain('Jane Doe');
    expect(description).not.toContain(id);
  });

  it('submission detail shows the label, or a placeholder when it no longer resolves', () => {
    const field = schema.fields[0];
    const show = (labels: Record<string, string>) =>
      getSubmissionFieldDisplay(field, schema.fields, { manager: id }, [], { labels, unavailableText: '(gone)' });
    expect(show({ manager: 'Jane Doe' })).toEqual({ kind: 'text', text: 'Jane Doe' });
    expect(show({})).toEqual({ kind: 'text', text: '(gone)' });
  });
});
