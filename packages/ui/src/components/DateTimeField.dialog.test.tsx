/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Dialog } from './Dialog';
import { DateTimePicker } from './DateTimePicker';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: {} } },
      interpolation: { escapeValue: false },
    });
  }
});

afterEach(() => cleanup());

function Harness({ initial, onValue, minDate }: { initial?: Date; onValue: (d?: Date) => void; minDate?: Date }) {
  const [value, setValue] = React.useState<Date | undefined>(initial);
  return (
    <Dialog isOpen onClose={() => {}} id="probe" title="Probe">
      <input aria-label="Other field" />
      <DateTimePicker
        label="Start Time"
        value={value}
        minDate={minDate}
        timeFormat="12h"
        clearable
        onChange={(d) => {
          setValue(d);
          onValue(d);
        }}
      />
    </Dialog>
  );
}

describe('DateTimePicker inside a real Dialog', () => {
  it('commits a rail pick after a day pick', async () => {
    const user = userEvent.setup();
    const seen: (Date | undefined)[] = [];
    render(<Harness onValue={(d) => seen.push(d)} />);
    const [dateInput, timeInput] = screen.getAllByRole('combobox') as HTMLInputElement[];
    await user.click(dateInput);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    const option = await screen.findByRole('option', { name: '2:15 PM' });
    await user.click(option);
    expect(seen.at(-1)?.getHours()).toBe(14);
    expect(seen.at(-1)?.getMinutes()).toBe(15);
    expect(timeInput.value).toBe('2:15 PM');
  });

  it('commits a rail pick when the field already holds a time', async () => {
    const user = userEvent.setup();
    const seen: (Date | undefined)[] = [];
    render(<Harness initial={new Date(2026, 8, 29, 15, 47)} onValue={(d) => seen.push(d)} />);
    const [, timeInput] = screen.getAllByRole('combobox') as HTMLInputElement[];
    await user.click(timeInput);
    await user.click(await screen.findByRole('option', { name: '9:15 AM' }));
    expect(seen.at(-1)?.getHours()).toBe(9);
  });

  it('commits a typed time after a day pick (Enter)', async () => {
    const user = userEvent.setup();
    const seen: (Date | undefined)[] = [];
    render(<Harness onValue={(d) => seen.push(d)} />);
    const [dateInput, timeInput] = screen.getAllByRole('combobox') as HTMLInputElement[];
    await user.click(dateInput);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await new Promise((r) => setTimeout(r, 50));
    await user.keyboard('2:37 PM');
    await user.keyboard('{Enter}');
    expect(seen.at(-1)?.getHours()).toBe(14);
    expect(seen.at(-1)?.getMinutes()).toBe(37);
  });

  it('commits a typed time after a day pick when focus moves elsewhere', async () => {
    const user = userEvent.setup();
    const seen: (Date | undefined)[] = [];
    render(<><Harness onValue={(d) => seen.push(d)} /></>);
    const [dateInput, timeInput] = screen.getAllByRole('combobox') as HTMLInputElement[];
    await user.click(dateInput);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await new Promise((r) => setTimeout(r, 50));
    await user.keyboard('2:37 PM');
    await user.click(screen.getByRole('textbox', { name: 'Other field' }));
    expect(seen.at(-1)?.getHours()).toBe(14);
  });

  it('commits a rail pick from the nested (inline) dialog variant', async () => {
    const user = userEvent.setup();
    const seen: (Date | undefined)[] = [];
    render(
      <Dialog isOpen onClose={() => {}} id="outer" title="Outer">
        <Harness onValue={(d) => seen.push(d)} />
      </Dialog>
    );
    const [dateInput, timeInput] = screen.getAllByRole('combobox') as HTMLInputElement[];
    await user.click(dateInput);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await user.click(await screen.findByRole('option', { name: '2:15 PM' }));
    expect(seen.at(-1)?.getHours()).toBe(14);
  });
});
