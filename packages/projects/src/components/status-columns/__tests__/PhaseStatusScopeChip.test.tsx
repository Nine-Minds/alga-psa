/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PhaseStatusScopeChip } from '../PhaseStatusScopeChip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

function translate(key: string, arg2?: unknown): string {
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const dictionary: Record<string, string> = {
    'phases.statusColumns': 'Status columns',
    'phases.statusColumnsCustom': 'Custom ({{count}} statuses)',
    'phases.statusColumnsProjectDefaults': 'Project defaults',
  };
  const template = dictionary[key] ?? key;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m: string, name: string) => String(opts[name] ?? ''));
}

afterEach(() => {
  cleanup();
});

describe('PhaseStatusScopeChip', () => {
  it('stays shrinkable so it cannot crush the phase name beside it', () => {
    render(<PhaseStatusScopeChip customStatusCount={5} id="chip" />);

    const chip = document.getElementById('chip') as HTMLElement;
    expect(chip).toBeInTheDocument();
    // Without these the chip claims its full intrinsic width in the 250px phase
    // panel and the name wraps one character per line.
    expect(chip.className).toContain('min-w-0');
    expect(chip.className).toContain('max-w-full');

    const label = screen.getByText('Custom (5 statuses)');
    expect(label.className).toContain('truncate');
  });

  it('keeps its chip styling when a consumer passes layout classes', () => {
    render(<PhaseStatusScopeChip customStatusCount={0} id="chip" className="mt-1" />);

    const chip = document.getElementById('chip') as HTMLElement;
    expect(chip.className).toContain('mt-1');
    expect(chip.className).toContain('inline-flex');
    expect(chip).toHaveTextContent('Project defaults');
  });

  it('renders nothing until the custom status count is known', () => {
    const { container } = render(<PhaseStatusScopeChip customStatusCount={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
