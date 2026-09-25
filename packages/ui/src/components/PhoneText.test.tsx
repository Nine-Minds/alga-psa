/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneText } from './PhoneText';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? 'ext.' }),
}));

afterEach(cleanup);

describe('PhoneText', () => {
  it('formats text and creates an E.164 tel link with an RFC 3966 extension', () => {
    render(<PhoneText value="+13202521658" extension="42" />);
    expect(screen.getByRole('link').textContent).toBe('+1 320 252 1658 ext. 42');
    expect(screen.getByRole('link').getAttribute('href')).toBe('tel:+13202521658;ext=42');
  });
  it('omits missing extensions and links for unparseable input', () => {
    const { rerender } = render(<PhoneText value="+13202521658" />);
    expect(screen.getByRole('link').textContent).toBe('+1 320 252 1658');
    rerender(<PhoneText value="call front desk" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('call front desk')).toBeTruthy();
  });
});
