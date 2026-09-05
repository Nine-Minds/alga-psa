import { describe, expect, it, vi } from 'vitest';
import {
  projectBillingActionErrorFrom,
  withProjectBillingActionErrors,
} from '../src/actions/projectBillingActionErrors';

const user = { user_id: '10000000-0000-4000-8000-000000000001' } as never;
const context = { tenant: '10000000-0000-4000-8000-000000000002' };

describe('project billing structured action errors', () => {
  it('maps database and permission failures to client-safe result objects', () => {
    expect(projectBillingActionErrorFrom({ code: '23505' })).toEqual({
      actionError: 'A conflicting project billing record already exists. Please refresh and try again.',
      messageKey: 'msp/billing:errors.projectBilling.duplicate',
    });
    expect(projectBillingActionErrorFrom(new Error('Permission denied: invoice generate required'))).toEqual({
      permissionError: 'Permission denied: invoice generate required',
    });
  });

  it('returns expected business failures rather than throwing across the server-action boundary', async () => {
    const wrapped = withProjectBillingActionErrors(async () => {
      throw new Error('Only pending schedule entries can be edited');
    });
    await expect(wrapped(user, context)).resolves.toEqual({
      actionError: 'Only pending schedule entries can be edited',
    });
  });

  it('keeps the key attached to custom schema issues', () => {
    expect(projectBillingActionErrorFrom({
      issues: [{
        code: 'custom',
        path: ['increase_total'],
        message: 'increase_total is only valid for amount-based entries',
        params: {
          messageKey: 'msp/billing:errors.projectBilling.validation.increaseTotalAmountOnly',
        },
      }],
    })).toEqual({
      actionError: 'increase_total is only valid for amount-based entries',
      messageKey: 'msp/billing:errors.projectBilling.validation.increaseTotalAmountOnly',
    });
  });

  it('logs unexpected failures and returns a stable safe message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrapped = withProjectBillingActionErrors(async () => {
      throw new Error('postgres host password=secret');
    });
    await expect(wrapped(user, context)).resolves.toEqual({
      actionError: 'Project billing could not complete the request. Please refresh and try again.',
      messageKey: 'msp/billing:errors.projectBilling.requestFailed',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
