// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../public/locales/en/common.json';
import type { UserEmailPreferenceCategoryState } from '../../../../../packages/notifications/src/types/notification';

const api = vi.hoisted(() => ({ read: vi.fn(), category: vi.fn(), subtype: vi.fn() }));
vi.mock('../../../../../packages/notifications/src/actions/notification-actions/notificationActions', () => ({
  getUserEmailPreferenceStateAction: api.read,
  updateUserEmailCategoryPreferencesAction: api.category,
  updateUserEmailSubtypePreferenceAction: api.subtype,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => en.emailPreferences[key.split('.')[1] as keyof typeof en.emailPreferences] }) }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: ({ checked, onCheckedChange, ...props }: any) => <button {...props} role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ indeterminate, ...props }: any) => <input {...props} type="checkbox" data-indeterminate={indeterminate} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: (props: any) => <button {...props} /> }));
import { EmailNotificationPreferences } from '../../../../../packages/notifications/src/components/settings/EmailNotificationPreferences';

let persisted: UserEmailPreferenceCategoryState[];
const clone = () => structuredClone(persisted);
const deferred = () => { let resolve!: (value: any) => void; let reject!: (error: Error) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const get = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const ready = () => waitFor(() => expect(get('Synthetic email').disabled).toBe(false));
const update = (ids: number[], enabled: boolean) => {
  persisted[0].subtypes.forEach(s => { if (ids.includes(s.id)) { s.user_is_enabled = enabled; s.effective_is_enabled = enabled; s.has_user_override = true; } });
  return clone();
};

beforeEach(() => {
  vi.clearAllMocks();
  persisted = [{ id: 1, name: 'Synthetic email', is_enabled: true, is_default_enabled: true,
    subtypes: [
      { id: 11, category_id: 1, name: 'First email', is_enabled: true, is_default_enabled: true, user_is_enabled: false, effective_is_enabled: false, has_user_override: true },
      { id: 12, category_id: 1, name: 'Second email', is_enabled: true, is_default_enabled: false, user_is_enabled: true, effective_is_enabled: true, has_user_override: false },
      { id: 13, category_id: 1, name: 'Restricted email', is_enabled: false, is_default_enabled: false, user_is_enabled: true, effective_is_enabled: false, has_user_override: true },
    ],
  }] as UserEmailPreferenceCategoryState[];
  api.read.mockImplementation(async () => clone());
  api.subtype.mockImplementation(async (id, enabled) => update([id], enabled));
  api.category.mockImplementation(async (_id, enabled) => update([11, 12], enabled));
});

describe('personal email preferences UI', () => {
  it('hydrates saved state and mixed categories, applies restrictions, and persists subtype/category changes', async () => {
    render(<EmailNotificationPreferences />); await ready();
    expect(get('First email').getAttribute('aria-checked')).toBe('false');
    expect(get('Synthetic email').getAttribute('aria-checked')).toBe('mixed');
    expect(get('Restricted email').disabled).toBe(true);
    fireEvent.click(get('First email')); await ready();
    expect(api.subtype).toHaveBeenCalledWith(11, true);
    expect(get('Synthetic email').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(get('Synthetic email')); await ready();
    expect(api.category).toHaveBeenCalledTimes(1);
    expect(api.category).toHaveBeenCalledWith(1, false);
    expect(get('Second email').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(get('Synthetic email')); await ready();
    expect(get('Second email').getAttribute('aria-checked')).toBe('true');
    expect(get('Restricted email').getAttribute('aria-checked')).toBe('false');
  });

  it('disables rapid and overlapping events until the accepted mutation settles, then accepts the next intent', async () => {
    render(<EmailNotificationPreferences />); await ready();
    const pending = deferred(); api.category.mockReturnValueOnce(pending.promise);
    fireEvent.click(get('Synthetic email'));
    fireEvent.click(get('Synthetic email')); fireEvent.click(get('First email'));
    await waitFor(() => expect(api.category).toHaveBeenCalledTimes(1));
    expect(api.subtype).not.toHaveBeenCalled();
    expect(get('First email').disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Saving/);
    await act(async () => pending.resolve(update([11, 12], true))); await ready();
    fireEvent.click(get('First email')); await ready();
    expect(get('Synthetic email').getAttribute('aria-checked')).toBe('mixed');
    expect(persisted[0].subtypes[0].effective_is_enabled).toBe(false);
  });

  it('keeps a slow unresolved save pending and never releases a second writer on a timer', async () => {
    render(<EmailNotificationPreferences />); await ready();
    const pending = deferred(); api.category.mockReturnValueOnce(pending.promise);
    vi.useFakeTimers();
    try {
      fireEvent.click(get('Synthetic email'));
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(screen.getByRole('status').textContent).toMatch(/taking longer/);
      expect(get('First email').disabled).toBe(true);
      fireEvent.click(get('First email'));
      expect(api.subtype).not.toHaveBeenCalled();
      await act(async () => pending.resolve(update([11, 12], true)));
      expect(get('First email').disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('restores confirmed state on persistence failure, reloads, and allows a successful retry', async () => {
    render(<EmailNotificationPreferences />); await ready();
    api.subtype.mockRejectedValueOnce(new Error('database failure'));
    fireEvent.click(get('First email')); await ready();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not confirm/);
    expect(get('First email').getAttribute('aria-checked')).toBe('false');
    expect(api.read).toHaveBeenCalledTimes(2);
    fireEvent.click(get('First email')); await ready();
    expect(get('First email').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides unknown state after a connection timeout and failed reconciliation; load retry works', async () => {
    render(<EmailNotificationPreferences />); await ready();
    api.category.mockRejectedValueOnce(new Error('Timeout acquiring a connection'));
    api.read.mockRejectedValueOnce(new Error('connection unavailable'));
    fireEvent.click(get('Synthetic email'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load/));
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByText('Retry')); await ready();
    expect(get('First email').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(get('Synthetic email')); await ready();
    expect(get('First email').getAttribute('aria-checked')).toBe('true');
  });

  it('reconciles an unknown commit outcome using the saved state instead of blindly rolling back', async () => {
    render(<EmailNotificationPreferences />); await ready();
    api.subtype.mockImplementationOnce(async () => { update([11], true); throw new Error('response lost'); });
    fireEvent.click(get('First email')); await ready();
    expect(get('First email').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('waits for an accepted save across unmount/re-entry and ignores the old component response', async () => {
    const first = render(<EmailNotificationPreferences />); await ready();
    const pending = deferred(); api.category.mockReturnValueOnce(pending.promise);
    fireEvent.click(get('Synthetic email'));
    await waitFor(() => expect(api.category).toHaveBeenCalledTimes(1));
    first.unmount(); render(<EmailNotificationPreferences />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading/);
    expect(api.read).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(update([11, 12], true))); await ready();
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(get('First email').getAttribute('aria-checked')).toBe('true');
  });

  it('shows initial load errors with retry and applies tenant-wide restrictions on reload', async () => {
    api.read.mockRejectedValueOnce(new Error('load failed'));
    render(<EmailNotificationPreferences />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    persisted[0].is_enabled = false;
    persisted[0].subtypes.forEach(s => { s.effective_is_enabled = false; });
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(get('Synthetic email').disabled).toBe(true);
    expect(get('Second email').disabled).toBe(true);
    expect(get('Second email').getAttribute('aria-checked')).toBe('false');
  });
});
