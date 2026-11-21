// @vitest-environment jsdom
/**
 * F070: timesheet submission surfaces are absent for a seat technician (operational mode) and unchanged for everyone
 * else (flag off, no seats, no provider: the mode is `commercial`). The server refuses submission by principal as well
 * (see seatTimeAccess.test.ts); this is the screen half.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? k) }),
}));

import { TimeSheetHeader } from '../src/components/time-management/time-entry/time-sheet/TimeSheetHeader';
import { TimeEntryModeProvider } from '../src/context/TimeEntryModeContext';

const header = () => (
  <TimeSheetHeader status="DRAFT" isEditable onSubmit={async () => {}} onBack={() => {}} />
);

describe('TimeSheetHeader submission control', () => {
  afterEach(() => cleanup());

  it('is absent for a seat technician (operational mode)', () => {
    render(<TimeEntryModeProvider mode="operational">{header()}</TimeEntryModeProvider>);
    expect(document.getElementById('submit-timesheet-button')).toBeNull();
  });

  it('is unchanged without a provider and in commercial mode', () => {
    render(header());
    expect(document.getElementById('submit-timesheet-button')).not.toBeNull();
    cleanup();
    render(<TimeEntryModeProvider mode="commercial">{header()}</TimeEntryModeProvider>);
    expect(document.getElementById('submit-timesheet-button')).not.toBeNull();
  });
});
