/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  custom: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ toast: toastMocks }));

const { handleError } = await import('./errorHandling');

describe('handleError message precedence', () => {
  beforeEach(() => {
    toastMocks.error.mockClear();
    toastMocks.custom.mockClear();
  });

  it('shows a returned actionError even when a fallback is supplied', () => {
    handleError(
      { actionError: 'Ticket list filters are no longer valid. Refresh the page and try again.' },
      'Failed to fetch tickets',
    );

    expect(toastMocks.error).toHaveBeenCalledWith(
      'Ticket list filters are no longer valid. Refresh the page and try again.',
    );
  });

  it('uses the supplied fallback for an ordinary thrown error', () => {
    handleError(new Error('connection terminated unexpectedly'), 'Failed to fetch tickets');

    expect(toastMocks.error).toHaveBeenCalledWith('Failed to fetch tickets');
  });

  it('uses the supplied fallback for an unknown value', () => {
    handleError({ weird: true }, 'Failed to fetch tickets');

    expect(toastMocks.error).toHaveBeenCalledWith('Failed to fetch tickets');
  });

  it('keeps permission payloads on their custom presentation', () => {
    handleError({ permissionError: 'Zugriff verweigert' }, 'Failed to fetch tickets');

    expect(toastMocks.custom).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
