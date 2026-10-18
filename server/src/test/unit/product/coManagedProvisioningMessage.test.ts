import { describe, expect, it } from 'vitest';
import { provisioningRejectionMessage } from '../../../components/co-managed/coManagedProvisioningMessage';

const t = (key: string, options?: { defaultValue: string }) => `${key}|${options?.defaultValue ?? ''}`;

describe('provisioningRejectionMessage', () => {
  it('tells the MSP the administrator email is already used elsewhere', () => {
    expect(provisioningRejectionMessage('ADMINISTRATOR_EMAIL_IN_USE', t))
      .toBe('coManaged.provisioning.administratorEmailInUse|This administrator email already belongs to a user in another workspace. Use a different email address.');
  });

  it('keeps unknown codes on the generic rejection', () => {
    expect(provisioningRejectionMessage('SOMETHING_ELSE', t)).toBe('coManaged.provisioning.rejected|');
  });
});
