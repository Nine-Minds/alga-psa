import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';

const mocks = vi.hoisted(() => ({
  getServerTranslation: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: mocks.getServerTranslation,
}));

const { localizeActionError } = await import('./localizeActionError');

/** Stands in for i18next: echoes the namespace it was asked for and interpolates. */
function translatorFor(namespace: string) {
  return (key: string, options?: Record<string, unknown>) => {
    const params = { ...(options ?? {}) };
    delete params.defaultValue;
    const suffix = Object.keys(params).length ? ` ${JSON.stringify(params)}` : '';
    return `[${namespace}] ${key}${suffix}`;
  };
}

beforeEach(() => {
  mocks.getServerTranslation.mockReset();
  mocks.getServerTranslation.mockImplementation(async (_locale: unknown, namespace: string) => ({
    t: translatorFor(namespace),
  }));
});

describe('localizeActionError', () => {
  it('leaves a key-less action error untouched', async () => {
    const payload = actionError('A client with this name already exists') as unknown;

    await expect(localizeActionError(payload)).resolves.toBe(payload);
    expect(mocks.getServerTranslation).not.toHaveBeenCalled();
  });

  it('leaves non-error results untouched', async () => {
    const result = { clients: [{ id: '1' }] };

    await expect(localizeActionError(result)).resolves.toBe(result);
    expect(mocks.getServerTranslation).not.toHaveBeenCalled();
  });

  it('translates a keyed action error and keeps the key', async () => {
    const payload = actionError(
      'A client with this name already exists',
      'msp/clients:errors.duplicateName',
      { name: 'Hotels.com' },
    ) as unknown;

    const localized = (await localizeActionError(payload)) as Record<string, unknown>;

    expect(mocks.getServerTranslation).toHaveBeenCalledWith(undefined, 'msp/clients');
    expect(localized.actionError).toBe('[msp/clients] errors.duplicateName {"name":"Hotels.com"}');
    expect(localized.messageKey).toBe('msp/clients:errors.duplicateName');
    expect(localized.messageParams).toEqual({ name: 'Hotels.com' });
  });

  it('translates a keyed permission error', async () => {
    const payload = permissionError(
      'Permission denied: Cannot view tickets',
      'msp/tickets:errors.readDenied',
    ) as unknown;

    const localized = (await localizeActionError(payload)) as Record<string, unknown>;

    expect(mocks.getServerTranslation).toHaveBeenCalledWith(undefined, 'msp/tickets');
    expect(localized.permissionError).toBe('[msp/tickets] errors.readDenied');
  });

  it('leaves a key-less { success: false, error } result untouched', async () => {
    const payload = { success: false, error: 'Current password is incorrect' } as unknown;

    await expect(localizeActionError(payload)).resolves.toBe(payload);
    expect(mocks.getServerTranslation).not.toHaveBeenCalled();
  });

  it('translates a keyed { success: false, error } result and keeps its other fields', async () => {
    const payload = {
      success: false,
      error: 'Current password is incorrect',
      errorCode: 'CURRENT_PASSWORD_INCORRECT',
      messageKey: 'common:errors.password.currentIncorrect',
    } as unknown;

    const localized = (await localizeActionError(payload)) as Record<string, unknown>;

    expect(mocks.getServerTranslation).toHaveBeenCalledWith(undefined, 'common');
    expect(localized.error).toBe('[common] errors.password.currentIncorrect');
    expect(localized.success).toBe(false);
    expect(localized.errorCode).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(localized.messageKey).toBe('common:errors.password.currentIncorrect');
  });

  it('leaves a successful result carrying an error field untouched', async () => {
    // `success` must be literally false; a partial-success payload that reports a
    // non-fatal `error` alongside its data is not this channel.
    const payload = {
      success: true,
      error: 'One row was skipped',
      messageKey: 'common:errors.password.currentIncorrect',
    } as unknown;

    await expect(localizeActionError(payload)).resolves.toBe(payload);
    expect(mocks.getServerTranslation).not.toHaveBeenCalled();
  });

  it('defaults to the common namespace when the key carries none', async () => {
    const payload = actionError('Not authenticated', 'errors.auth.notAuthenticated') as unknown;

    await localizeActionError(payload);

    expect(mocks.getServerTranslation).toHaveBeenCalledWith(undefined, 'common');
  });

  it('is idempotent for a wrapped action calling another wrapped action', async () => {
    const payload = actionError('Ticket not found', 'msp/tickets:errors.notFound') as unknown;

    const once = await localizeActionError(payload);
    const twice = await localizeActionError(once);

    expect((twice as Record<string, unknown>).actionError).toBe(
      (once as Record<string, unknown>).actionError,
    );
  });

  it('degrades to English when there is no request scope (worker / pg-boss)', async () => {
    // getServerLocale reads cookies(); outside a request Next throws rather than
    // returning a default, and a background job must not fail on a missing locale.
    mocks.getServerTranslation.mockRejectedValue(
      new Error('`cookies` was called outside a request scope.'),
    );

    const payload = actionError('Ticket not found', 'msp/tickets:errors.notFound') as unknown;

    const localized = (await localizeActionError(payload)) as Record<string, unknown>;

    expect(localized.actionError).toBe('Ticket not found');
    expect(localized.messageKey).toBe('msp/tickets:errors.notFound');
  });

  it('falls back to the English message when the key is missing from the pack', async () => {
    mocks.getServerTranslation.mockResolvedValue({ t: () => '' });

    const payload = actionError('Ticket not found', 'msp/tickets:errors.notFound') as unknown;

    const localized = (await localizeActionError(payload)) as Record<string, unknown>;

    expect(localized.actionError).toBe('Ticket not found');
  });
});
