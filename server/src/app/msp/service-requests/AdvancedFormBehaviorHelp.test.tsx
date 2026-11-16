// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedFormBehaviorHelp } from './AdvancedFormBehaviorHelp';
import { ADVANCED_FORM_BEHAVIOR_EXAMPLES, CONTEXT_DEFAULT_PLACEHOLDERS } from './advancedFormBehaviorExamples';
import { VISIBILITY_OPERATORS } from './fieldVisibilityModel';

const en = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../public/locales/en/msp/service-requests.json'), 'utf8')
);
const lookup = (key: string): unknown => key.split('.').reduce<any>((node, part) => node?.[part], en);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => (lookup(key) as string | undefined) ?? `MISSING:${key}` }),
}));

describe('AdvancedFormBehaviorHelp', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders exactly one entry per VISIBILITY_OPERATORS value, each with an en translation', () => {
    render(<AdvancedFormBehaviorHelp />);
    const items = within(document.getElementById('service-request-form-behavior-help-operators')!).getAllByRole('listitem');
    expect(items).toHaveLength(VISIBILITY_OPERATORS.length);
    VISIBILITY_OPERATORS.forEach((operator, index) => {
      const label = lookup(`editor.form.visibility.operators.${operator}`);
      expect(typeof label).toBe('string');
      expect(items[index].textContent).toContain(operator);
      expect(items[index].textContent).toContain(label as string);
    });
  });

  it('has no missing translation key', () => {
    const { container } = render(<AdvancedFormBehaviorHelp />);
    expect(container.textContent).not.toContain('MISSING:');
  });

  it('covers the rule semantics, context placeholders, timing and edition', () => {
    render(<AdvancedFormBehaviorHelp />);
    for (const key of ['ruleAll', 'ruleNone', 'ruleEarlier', 'ruleHidden', 'timing', 'edition', 'whatItIs']) {
      expect(screen.getByText(lookup(`editor.execution.advanced.help.${key}`) as string)).toBeTruthy();
    }
    for (const name of CONTEXT_DEFAULT_PLACEHOLDERS) {
      expect(screen.getByText(`{{${name}}}`)).toBeTruthy();
    }
  });

  it('shows all three examples with a copy button that copies the JSON and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<AdvancedFormBehaviorHelp />);
    expect(ADVANCED_FORM_BEHAVIOR_EXAMPLES).toHaveLength(3);
    for (const example of ADVANCED_FORM_BEHAVIOR_EXAMPLES) {
      const block = document.getElementById(`service-request-form-behavior-example-${example.id}`)!;
      expect(JSON.parse(block.querySelector('pre')!.textContent!)).toEqual(example.config);
    }
    fireEvent.click(document.getElementById('service-request-form-behavior-example-clientScoped-copy')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(ADVANCED_FORM_BEHAVIOR_EXAMPLES[2].config);
  });

  it('falls back to execCommand when the Clipboard API is denied (plain-http self-hosted installs)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render(<AdvancedFormBehaviorHelp />);
    fireEvent.click(document.getElementById('service-request-form-behavior-example-showWhen-copy')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a copy failure when both the Clipboard API and the fallback fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
    render(<AdvancedFormBehaviorHelp />);
    fireEvent.click(document.getElementById('service-request-form-behavior-example-showWhen-copy')!);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
