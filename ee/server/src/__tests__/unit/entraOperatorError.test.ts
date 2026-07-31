import { describe, expect, it } from 'vitest';
import { entraRouteErrorMessage } from '@ee/app/api/integrations/entra/_errors';
import {
  EntraOperatorError,
  isEntraOperatorError,
  isTimeoutError,
} from '@ee/lib/integrations/entra/entraOperatorError';

describe('entraRouteErrorMessage', () => {
  it('passes through a message written for an operator', () => {
    const error = new EntraOperatorError(
      'timeout',
      'CIPP did not answer within 20 seconds. It may still be gathering the directory — try again in a moment.'
    );

    expect(entraRouteErrorMessage(error, 'Entra preflight failed.')).toContain('20 seconds');
  });

  it('still hides anything that was not', () => {
    // Driver text and stack detail are not for this screen.
    const error = new Error('read ECONNRESET at TLSWrap.onStreamRead');
    expect(entraRouteErrorMessage(error, 'Entra preflight failed.')).toBe('Entra preflight failed.');
  });

  it('keeps the legacy allowlist working', () => {
    const error = new Error('No active Entra connection exists for this tenant.');
    expect(entraRouteErrorMessage(error, 'Entra preflight failed.')).toBe(
      'No active Entra connection exists for this tenant.'
    );
  });

  it('recognises the error across a duplicated module instance', () => {
    // EE and CE can load the same file twice, which defeats instanceof — the
    // adapters and the route would then disagree about what is safe to show.
    const lookalike = Object.assign(new Error('CIPP rejected the stored API credential.'), {
      name: 'EntraOperatorError',
      code: 'credential-rejected',
    });

    expect(isEntraOperatorError(lookalike)).toBe(true);
    expect(entraRouteErrorMessage(lookalike, 'Entra preflight failed.')).toContain('rejected');
  });
});

describe('isTimeoutError', () => {
  it('separates running out of time from being told no', () => {
    // What axios raises when its own timeout fires, and what a socket timeout
    // surfaces as. Neither carries a response.
    expect(isTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);

    expect(isTimeoutError({ code: 'ERR_BAD_REQUEST', response: { status: 401 } })).toBe(false);
    expect(isTimeoutError(new Error('boom'))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
