// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CoManagedWorkspaceBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: false, admitted: false, resolved: true }) }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }) }));
vi.mock('@/components/co-managed/CoManagedAcceptanceBoundary', () => ({ default: ({ children }: any) => children }));
afterEach(cleanup);

it('keeps the customer workspace closed when the capability is disabled', () => {
  render(<CoManagedWorkspaceBoundary productCode="co_managed" requireAcceptance><div>Ticket queue</div></CoManagedWorkspaceBoundary>);
  expect(screen.queryByText('Ticket queue')).not.toBeInTheDocument();
  expect(screen.getByText('Co-managed IT is not available')).toBeInTheDocument();
});
