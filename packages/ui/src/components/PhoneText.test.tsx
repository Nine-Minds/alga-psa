/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import englishCommon from '../../../../server/public/locales/en/common.json';
import germanCommon from '../../../../server/public/locales/de/common.json';
import { PhoneText } from './PhoneText';

const i18n = createInstance();

vi.mock('../lib/i18n/client', () => ({
  useTranslation: (namespace: string) => ({ t: i18n.getFixedT(null, namespace) }),
}));

beforeEach(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    resources: { en: { common: englishCommon }, de: { common: germanCommon } },
  });
});

afterEach(cleanup);

describe('PhoneText', () => {
  it('uses the locale extension label without changing the dial target', async () => {
    await i18n.changeLanguage('de');
    render(<PhoneText value="+13202521658" extension="42" />);
    expect(screen.getByRole('link').textContent).toBe('+1 320 252 1658 Durchw. 42');
    expect(screen.getByRole('link').getAttribute('href')).toBe('tel:+13202521658;ext=42');
  });
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
