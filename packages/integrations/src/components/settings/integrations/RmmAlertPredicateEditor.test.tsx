import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PredicateGroup } from '@alga-psa/predicates';
import RmmAlertPredicateEditor from './RmmAlertPredicateEditor';

describe('RmmAlertPredicateEditor', () => {
  it('preserves nested predicate groups when adding a new condition', () => {
    const nested: PredicateGroup = {
      join: 'and', clauses: [{ join: 'or', clauses: [
        { path: 'alertClass', operator: 'equals', value: 'Critical Service Crashed' },
        { path: 'text', operator: 'contains_ci', value: 'Sentinel Agent' },
      ] }],
    };
    const onChange = vi.fn();
    render(<RmmAlertPredicateEditor value={nested} onChange={onChange} t={(_key, fallback) => fallback ?? _key} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(onChange).toHaveBeenCalledWith({
      ...nested,
      clauses: [...nested.clauses, { path: 'text', operator: 'contains_ci', value: '' }],
    });
  });
});
