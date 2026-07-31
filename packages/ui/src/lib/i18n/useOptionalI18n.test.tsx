/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useOptionalI18n } from './client';

// The server-suite setup file globally mocks this module (components under
// test there always want a stubbed i18n); this test exercises the REAL
// no-provider behavior, so undo that mock. No-op under the package config.
vi.unmock('@alga-psa/ui/lib/i18n/client');

function Probe() {
  const i18n = useOptionalI18n();
  return <div data-testid="probe">{i18n === null ? 'no-provider' : `locale:${i18n.locale}`}</div>;
}

describe('useOptionalI18n', () => {
  afterEach(cleanup);

  it('returns null outside I18nProvider without throwing', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('no-provider');
  });
});
