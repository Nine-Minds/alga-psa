// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PredicateGroup } from '@alga-psa/predicates';
import RmmAlertPredicateEditor from './RmmAlertPredicateEditor';
import { RMM_ALERT_PREDICATE_FIELDS } from './rmmAlertPredicateFields';
import { rmmAlertQuerySchema } from '@alga-psa/shared/rmm/alerts/contracts';
import { OPERATORS_BY_TYPE } from '@alga-psa/predicates';

describe('RmmAlertPredicateEditor', () => {
  it('exposes every schema field and every operator allowed for that field', () => {
    expect(RMM_ALERT_PREDICATE_FIELDS.map(field => field.path).sort()).toEqual(Object.keys(rmmAlertQuerySchema.attributes).sort());
    for (const field of RMM_ALERT_PREDICATE_FIELDS) {
      const schemaField = rmmAlertQuerySchema.attributes[field.path];
      const allowed = schemaField.kind === 'computed'
        ? schemaField.operators
        : schemaField.kind === 'set'
          ? OPERATORS_BY_TYPE[schemaField.valueType]
          : schemaField.operators ?? OPERATORS_BY_TYPE[schemaField.type];
      expect([...field.operators].sort()).toEqual([...allowed].sort());
    }
  });

  it('preserves nested predicate groups when adding a new condition', () => {
    const nested: PredicateGroup = {
      join: 'and', clauses: [{ join: 'or', clauses: [
        { path: 'alertClass', operator: 'equals', value: 'Critical Service Crashed' },
        { path: 'text', operator: 'contains_ci', value: 'Sentinel Agent' },
      ] }],
    };
    const onChange = vi.fn();
    render(<RmmAlertPredicateEditor value={nested} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    // `<Button id=...>` registers the id with the UI reflection system rather than
    // the DOM under jsdom (same observation as AccountingMappingDialog.targetKind.test.tsx),
    // so address the control by role. The root group renders after its nested group,
    // so its "Add condition" button is the last one.
    const addCondition = screen.getAllByRole('button', { name: 'Add condition' });
    fireEvent.click(addCondition[addCondition.length - 1]);
    expect(onChange).toHaveBeenCalledWith({
      ...nested,
      clauses: [...nested.clauses, { path: 'severity', operator: 'in', value: [] }],
    });
  });

  it('recursively renders nested clauses and exposes edit and removal controls', () => {
    const nested: PredicateGroup = { join: 'and', clauses: [{ join: 'or', clauses: [{ path: 'text', operator: 'contains_ci', value: 'Sentinel' }] }] };
    render(<RmmAlertPredicateEditor value={nested} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={vi.fn()} t={(_key, fallback) => fallback ?? _key} />);
    expect(screen.getByDisplayValue('Sentinel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove group' })).toBeTruthy();
    expect(document.querySelector('#rmm-predicate-field-0-0')).toBeTruthy();
  });

  it('normalizes scalar values to lists and lists to scalar values on operator changes', () => {
    const onChange = vi.fn();
    render(<RmmAlertPredicateEditor value={{ join: 'and', clauses: [{ path: 'severity', operator: 'equals', value: 'critical' }] }} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    fireEvent.click(document.querySelector('#rmm-predicate-operator-0')!);
    fireEvent.click(screen.getByRole('option', { name: 'in' }));
    expect(onChange).toHaveBeenLastCalledWith({ join: 'and', clauses: [{ path: 'severity', operator: 'in', value: ['critical'] }] });
  });

  it('normalizes list values to a scalar when switching in to equals', () => {
    const onChange = vi.fn();
    render(<RmmAlertPredicateEditor value={{ join: 'and', clauses: [{ path: 'severity', operator: 'in', value: ['critical', 'major'] }] }} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    fireEvent.click(document.querySelector('#rmm-predicate-operator-0')!);
    fireEvent.click(screen.getByRole('option', { name: 'equals' }));
    expect(onChange).toHaveBeenLastCalledWith({ join: 'and', clauses: [{ path: 'severity', operator: 'equals', value: 'critical' }] });
  });

  it('removes a nested group and disables every selector while saving', () => {
    const onChange = vi.fn();
    const nested: PredicateGroup = { join: 'and', clauses: [{ join: 'or', clauses: [{ path: 'severity', operator: 'in', value: ['critical'] }] }] };
    const { container, rerender } = render(<RmmAlertPredicateEditor value={nested} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} disabled t={(_key, fallback) => fallback ?? _key} />);
    expect([...container.querySelectorAll('[role="combobox"]')].every(select => (select as HTMLButtonElement).disabled)).toBe(true);
    rerender(<RmmAlertPredicateEditor value={nested} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove group' }));
    expect(onChange).toHaveBeenLastCalledWith({ join: 'and', clauses: [] });
  });

  it('preserves typed spaces and separators while entering multiple list values', () => {
    const onChange = vi.fn();
    function Editor() {
      const [value, setValue] = React.useState<PredicateGroup>({
        join: 'and', clauses: [{ path: 'alertClass', operator: 'in', value: [] }],
      });
      return <RmmAlertPredicateEditor value={value} fields={RMM_ALERT_PREDICATE_FIELDS}
        onChange={next => { setValue(next); onChange(next); }}
        t={(_key, fallback) => fallback ?? _key} />;
    }
    render(<Editor />);
    const input = screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;
    fireEvent.focus(input);
    for (const text of ['Critical ', 'Critical Service Crashed, ', 'Critical Service Crashed, Other Service']) {
      fireEvent.change(input, { target: { value: text } });
      expect(input.value).toBe(text);
    }
    expect(onChange).toHaveBeenLastCalledWith({
      join: 'and', clauses: [{ path: 'alertClass', operator: 'in', value: ['Critical Service Crashed', 'Other Service'] }],
    });
    fireEvent.blur(input);
    expect(input.value).toBe('Critical Service Crashed, Other Service');
  });

  it('keeps legacy regex conditions visible while editing other clauses', () => {
    const onChange = vi.fn();
    render(<RmmAlertPredicateEditor value={{ join: 'and', clauses: [], legacyMessagePattern: 'Sentinel.*' }} fields={RMM_ALERT_PREDICATE_FIELDS} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    expect(screen.getByText('Sentinel.*')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(onChange).toHaveBeenLastCalledWith({ join: 'and', clauses: [{ path: 'severity', operator: 'in', value: [] }], legacyMessagePattern: 'Sentinel.*' });
  });
});
