/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateTokenInput, insertTemplateToken, type TemplateTokenOption } from './TemplateTokenInput';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

const TOKENS: TemplateTokenOption[] = [
  { token: 'employee_name', label: 'Employee Name', secondary: 'employee_name' },
  { token: 'start_date', label: 'Start Date', secondary: 'start_date' },
];

function Harness({ initial = '', tokens = TOKENS, error }: { initial?: string; tokens?: TemplateTokenOption[]; error?: string }) {
  const [value, setValue] = useState(initial);
  return <TemplateTokenInput id="subject" value={value} onChange={setValue} tokens={tokens} error={error} />;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Insert field' }));
}

afterEach(cleanup);

describe('insertTemplateToken', () => {
  it('replaces the selection', () => {
    expect(insertTemplateToken('Hello World', 6, 11, 'name')).toEqual({ text: 'Hello {{name}}', caret: 14 });
  });

  it('completes a started placeholder instead of duplicating it', () => {
    expect(insertTemplateToken('New: {{emp', 10, 10, 'employee_name').text).toBe('New: {{employee_name}}');
  });

  it('does not complete a placeholder whose prefix does not match', () => {
    expect(insertTemplateToken('{{xyz', 5, 5, 'employee_name').text).toBe('{{xyz{{employee_name}}');
  });
});

describe('TemplateTokenInput', () => {
  it('lists field labels with the key as secondary text', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openMenu(user);
    expect(await screen.findByText('Employee Name')).toBeTruthy();
    expect(screen.getByText('Start Date')).toBeTruthy();
    expect(screen.getAllByText('employee_name').length).toBeGreaterThan(0);
  });

  it('inserts at the caret, replacing the selection', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Hello World" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    await user.keyboard('{End}');
    input.setSelectionRange(6, 11);
    fireEvent.mouseUp(input);
    await openMenu(user);
    await user.click(await screen.findByText('Employee Name'));
    expect(input.value).toBe('Hello {{employee_name}}');
  });

  it('completes a started {{emp', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    // user-event reads `{{` as an escaped `{`, so `{{{{` types two braces.
    await user.type(input, 'New: {{{{emp');
    await openMenu(user);
    await user.click(await screen.findByText('Employee Name'));
    expect(input.value).toBe('New: {{employee_name}}');
  });

  it('appends when the input never had a caret', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Existing" />);
    await openMenu(user);
    await user.click(await screen.findByText('Start Date'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Existing{{start_date}}');
  });

  it('renders the error text and disables the menu when there are no tokens', () => {
    render(<Harness tokens={[]} error="Unknown field: {{nope}}" />);
    expect(screen.getByText('Unknown field: {{nope}}')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Insert field' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
