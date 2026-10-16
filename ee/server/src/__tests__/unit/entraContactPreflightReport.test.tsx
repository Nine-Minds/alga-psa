// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactPreflightReport } from '@ee/components/settings/integrations/entra/ContactPreflightReport';
import type { EntraPreflightResponse } from '@alga-psa/integrations/actions';

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});
vi.mock('@ee/components/settings/integrations/entra/RelativeTime', () => ({ RelativeTime: () => null }));

function report(reasons: Array<'excluded_by_filter' | 'disabled_account'>, warnings: string[] = [], unknownFieldCounts = { userType: 0, assignedLicenseCount: 0 }): EntraPreflightResponse {
  return {
    totalIdentities: reasons.length,
    checkedAt: new Date().toISOString(),
    warnings,
    unknownFieldCounts,
    excludedByReason: {},
    buckets: [{
      bucket: 'mark_inactive',
      count: reasons.length,
      samples: reasons.map((reason, index) => ({
        entraObjectId: `entra-${index}`,
        displayName: `User ${index}`,
        reason,
      })),
    }],
  } as EntraPreflightResponse;
}

function expandInactiveBucket() {
  fireEvent.click(document.getElementById('entra-preflight-expand-mark_inactive') as HTMLButtonElement);
}

describe('ContactPreflightReport', () => {
  it('uses filter exclusion copy without the disabled-account description', () => {
    render(<ContactPreflightReport report={report(['excluded_by_filter'])} />);
    expandInactiveBucket();
    expect(screen.getByText(/Excluded by the import filter/)).toBeTruthy();
    expect(screen.queryByText(/Microsoft account is disabled/)).toBeNull();
  });

  it('shows distinct descriptions for disabled and filter-excluded identities in a mixed bucket', () => {
    render(<ContactPreflightReport report={report(['excluded_by_filter', 'disabled_account'])} />);
    expandInactiveBucket();
    expect(screen.getByText(/Excluded by the import filter/)).toBeTruthy();
    expect(screen.getByText(/Microsoft account is disabled/)).toBeTruthy();
  });

  it('renders the unknown filter-field notice once when service warnings describe the same fields', () => {
    render(<ContactPreflightReport report={report([], [
      'User type data unavailable for 2 users; unknown users were kept.',
      'License data unavailable for 3 users; unknown users were kept.',
    ], { userType: 2, assignedLicenseCount: 3 })} />);
    expect(document.querySelectorAll('#entra-preflight-unknown-filter-fields')).toHaveLength(1);
    expect(screen.queryByText('User type data unavailable for 2 users; unknown users were kept.')).toBeNull();
    expect(screen.queryByText('License data unavailable for 3 users; unknown users were kept.')).toBeNull();
  });
});
