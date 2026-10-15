/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { validateExpressionSource } from '@alga-psa/workflows/authoring';

import {
  EXPRESSION_SYNTAX_EXAMPLES,
  ExpressionSyntaxHelp,
  getExpressionSyntaxFunctions,
} from '../ExpressionSyntaxHelp';

describe('ExpressionSyntaxHelp', () => {
  it('starts collapsed and expands to show the cheat-sheet', () => {
    render(<ExpressionSyntaxHelp idPrefix="if-condition" />);

    const toggle = screen.getByRole('button', { name: /syntax help/i });
    expect(toggle).toHaveAttribute('id', 'if-condition-syntax-help-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('payload.status in ["open", "new"]')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Join values with &.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('payload.status in ["open", "new"]')).toBeInTheDocument();
    expect(screen.getByText('payload.urgent = true ? "High" : "Normal"')).toBeInTheDocument();
    expect(screen.getByText('Functions')).toBeInTheDocument();
    expect(screen.getByText('coalesce(...values) -> any')).toBeInTheDocument();
  });

  it('lists every runtime catalog function with its expression example', () => {
    const functions = getExpressionSyntaxFunctions();
    expect(functions.map((fn) => fn.name)).toEqual(expect.arrayContaining(['nowIso', 'coalesce', 'len', 'toString']));
    expect(functions.find((fn) => fn.name === 'len')?.example).toBe('len(payload.items) > 0');
  });

  it('only shows examples the workflow runtime accepts', () => {
    const examples = [
      ...EXPRESSION_SYNTAX_EXAMPLES.map((entry) => entry.example),
      ...getExpressionSyntaxFunctions().map((fn) => fn.example),
    ];
    for (const example of examples) {
      expect(() => validateExpressionSource(example), example).not.toThrow();
    }
  });

  it('lists truncate and substring and points to the Transform steps for heavier text work', () => {
    const functions = getExpressionSyntaxFunctions();
    expect(functions.find((fn) => fn.name === 'truncate')?.signature).toBe('truncate(text, length, ending?) -> string');
    expect(functions.find((fn) => fn.name === 'substring')?.example).toBe('substring(payload.subject, 0, 20)');

    render(<ExpressionSyntaxHelp idPrefix="pointer" defaultOpen />);
    expect(document.getElementById('pointer-syntax-help-transforms')?.textContent).toContain('Truncate Text');
  });

  it('stacks rows and keeps expressions on one scrollable line for the narrow config panel', () => {
    render(<ExpressionSyntaxHelp idPrefix="narrow" defaultOpen />);
    const panel = document.getElementById('narrow-syntax-help-panel');
    expect(panel?.querySelector('[class*="grid-cols"]')).toBeNull();
    const samples = Array.from(panel?.querySelectorAll('code') ?? []);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.className).toContain('whitespace-pre');
      expect(sample.className).not.toContain('break-words');
    }
  });
});

