/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickCreateDialog, type QuickCreateType } from '../../../components/layout/QuickCreateDialog';

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

const renderDialog = (type: QuickCreateType, onClose = vi.fn()) =>
  render(<QuickCreateDialog type={type} onClose={onClose} />);

describe('QuickCreateDialog routed dispatch', () => {
  beforeEach(() => {
    routerPush.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('routes every quick-create flow to its intercepted create route', () => {
    const cases: Array<[Exclude<QuickCreateType, null>, string]> = [
      ['ticket', '/msp/create-ticket'],
      ['client', '/msp/create-client'],
      ['contact', '/msp/create-contact'],
      ['project', '/msp/create-project'],
      ['asset', '/msp/create-asset'],
      ['service', '/msp/create-service'],
      ['product', '/msp/create-product'],
    ];

    for (const [type, href] of cases) {
      const onClose = vi.fn();
      renderDialog(type, onClose);

      expect(routerPush).toHaveBeenLastCalledWith(href);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      cleanup();
    }

    expect(routerPush).toHaveBeenCalledTimes(cases.length);
  });

  it('does nothing when no quick-create type is selected', () => {
    const onClose = vi.fn();
    renderDialog(null, onClose);

    expect(routerPush).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
