// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? k) }),
}));

import { SeatEffortCard } from './SeatEffortCard';

describe('SeatEffortCard', () => {
  afterEach(() => cleanup());

  it('shows only the totals the server sent a technician: no MSP row when there is no MSP figure', () => {
    render(<SeatEffortCard effort={{ viewer: 'client_it', clientItMinutes: 90, ownMinutes: 45,
      ownEntries: [{ entry_id: 'e1', start_time: '2026-11-02T08:00:00Z', end_time: '2026-11-02T08:45:00Z', minutes: 45, notes: 'patched' }] }} />);
    expect(document.getElementById('seat-effort-client-it')).not.toBeNull();
    expect(document.getElementById('seat-effort-msp')).toBeNull();
    expect(document.getElementById('seat-effort-combined')).toBeNull();
    expect(screen.getByText('patched')).toBeTruthy();
  });

  it('shows the MSP row once the server includes it, and both totals plus the sum for MSP staff', () => {
    render(<SeatEffortCard effort={{ viewer: 'client_it', clientItMinutes: 90, mspMinutes: 80, ownMinutes: 0, ownEntries: [] }} />);
    expect(document.getElementById('seat-effort-msp')).not.toBeNull();
    cleanup();
    render(<SeatEffortCard effort={{ viewer: 'msp', clientItMinutes: 90, mspMinutes: 80, combinedMinutes: 170 }} />);
    expect(document.getElementById('seat-effort-msp')).not.toBeNull();
    expect(document.getElementById('seat-effort-combined')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Your time');
  });
});
