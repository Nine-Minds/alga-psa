/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';

const capability = vi.hoisted(() => ({ enabled: true, admitted: true, resolved: true }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => capability }));

describe('co-managed capability boundary presentation', () => {
  afterEach(() => cleanup());

  it('keeps native ticket content and hides feature controls when the capability is unavailable', () => {
    capability.enabled = false;
    capability.admitted = false;

    render(<main>
      <section aria-label="Native ticket">Native ticket controls</section>
      <CoManagedFeatureBoundary mode="serves"><button>Shared ticket action</button></CoManagedFeatureBoundary>
    </main>);

    expect(screen.getByLabelText('Native ticket')).toHaveTextContent('Native ticket controls');
    expect(screen.queryByRole('button', { name: 'Shared ticket action' })).toBeNull();
  });

  it('shows served read-only feature content while withholding admission-only controls', () => {
    capability.enabled = true;
    capability.admitted = false;

    render(<main>
      <section aria-label="Native ticket">Native ticket controls</section>
      <CoManagedFeatureBoundary mode="serves"><p>Shared ticket details</p></CoManagedFeatureBoundary>
      <CoManagedFeatureBoundary mode="admits"><button>Start sharing</button></CoManagedFeatureBoundary>
    </main>);

    expect(screen.getByLabelText('Native ticket')).toHaveTextContent('Native ticket controls');
    expect(screen.getByText('Shared ticket details')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start sharing' })).toBeNull();
  });
});
