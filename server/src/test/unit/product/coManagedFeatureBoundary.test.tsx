/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoManagedFeatureBoundary, CoManagedWorkspaceBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';

const { useFeatureFlag } = vi.hoisted(() => ({ useFeatureFlag: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('co-managed UI release boundary', () => {
  it.each([
    { enabled: false, loading: false, error: null },
    { enabled: true, loading: true, error: null },
    { enabled: undefined, loading: false, error: null },
    { enabled: true, loading: false, error: new Error('Flag unavailable') },
  ])('does not mount feature controls for unresolved or disabled state %j', (state) => {
    useFeatureFlag.mockReturnValue(state);
    render(<CoManagedFeatureBoundary><button>Escalate to MSP</button></CoManagedFeatureBoundary>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mounts only while enabled and removes controls when the flag changes', () => {
    useFeatureFlag.mockReturnValue({ enabled: true, loading: false, error: null });
    const view = render(<CoManagedWorkspaceBoundary productCode="co_managed"><button>Escalate to MSP</button></CoManagedWorkspaceBoundary>);
    expect(screen.getByRole('button').textContent).toBe('Escalate to MSP');
    expect(useFeatureFlag).toHaveBeenCalledWith('release-v1-6-feature', { defaultValue: false });
    useFeatureFlag.mockReturnValue({ enabled: false, loading: false, error: null });
    view.rerender(<CoManagedWorkspaceBoundary productCode="co_managed"><button>Escalate to MSP</button></CoManagedWorkspaceBoundary>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['psa', 'algadesk'] as const)('leaves ordinary %s UI independent of this flag', (productCode) => {
    render(<CoManagedWorkspaceBoundary productCode={productCode}><button>Existing ticket</button></CoManagedWorkspaceBoundary>);
    expect(screen.getByRole('button').textContent).toBe('Existing ticket');
    expect(useFeatureFlag).not.toHaveBeenCalled();
  });
});
