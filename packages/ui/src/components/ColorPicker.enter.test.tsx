/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import ColorPicker from './ColorPicker';

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

describe('ColorPicker hex input Enter handling', () => {
  afterEach(cleanup);

  it('saves the current hex draft and prevents stale outer form submission', () => {
    const onSave = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ColorPicker
          currentBackgroundColor="#111111"
          onSave={onSave}
          showTextColor={false}
          trigger={<button type="button">Choose color</button>}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose color' }));
    const input = screen.getByLabelText('Background Color') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#ABCDEF' } });

    const enter = createEvent.keyDown(input, { key: 'Enter' });
    fireEvent(input, enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledWith('#ABCDEF', null);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('discards a canceled draft when the picker is reopened', () => {
    const onSave = vi.fn();
    render(
      <ColorPicker
        currentBackgroundColor="#111111"
        onSave={onSave}
        showTextColor={false}
        trigger={<button type="button">Choose color</button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose color' }));
    const input = screen.getByLabelText('Background Color') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#ABCDEF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose color' }));
    expect((screen.getByLabelText('Background Color') as HTMLInputElement).value).toBe('#111111');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('#111111', null);
  });

  it('does not save invalid hex input when Enter is pressed', () => {
    const onSave = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ColorPicker
          currentBackgroundColor="#111111"
          onSave={onSave}
          showTextColor={false}
          trigger={<button type="button">Choose color</button>}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose color' }));
    const input = screen.getByLabelText('Background Color') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'invalid' } });
    const enter = createEvent.keyDown(input, { key: 'Enter' });
    fireEvent(input, enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
