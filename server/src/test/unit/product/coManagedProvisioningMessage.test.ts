import { describe, expect, it } from 'vitest';
import { provisioningRejectionMessage, seatChangeRejectionMessage } from '../../../components/co-managed/coManagedProvisioningMessage';

const t = (key: string, options?: { defaultValue: string }) => `${key}|${options?.defaultValue ?? ''}`;

describe('provisioningRejectionMessage', () => {
  it('tells the MSP the administrator email is already used elsewhere', () => {
    expect(provisioningRejectionMessage('ADMINISTRATOR_EMAIL_IN_USE', t))
      .toBe('coManaged.provisioning.administratorEmailInUse|This administrator email already belongs to a user in another workspace. Use a different email address.');
  });

  it('tells the MSP the administrator email is waiting on another invitation', () => {
    expect(provisioningRejectionMessage('ADMINISTRATOR_EMAIL_PENDING', t)).toMatch(/^coManaged.provisioning.administratorEmailPending\|This administrator email has a pending invitation/);
  });

  it('keeps unknown codes on the generic rejection', () => {
    expect(provisioningRejectionMessage('SOMETHING_ELSE', t)).toBe('coManaged.provisioning.rejected|');
  });

  it('names each seat-change refusal', () => {
    expect(seatChangeRejectionMessage('CO_MANAGED_SEAT_LIMIT', t)).toMatch(/^coManaged.provisioning.resizeBelowUsed\|/);
    expect(seatChangeRejectionMessage('CO_MANAGED_POOL_LIMIT', t)).toMatch(/^coManaged.provisioning.resizePoolLimit\|/);
    expect(seatChangeRejectionMessage('CO_MANAGED_LICENSE_LAPSED', t)).toMatch(/^coManaged.provisioning.resizeLicenseLapsed\|/);
    expect(seatChangeRejectionMessage('CO_MANAGED_ALLOCATION_CONFLICT', t)).toMatch(/^coManaged.provisioning.resizeError\|/);
  });
});
