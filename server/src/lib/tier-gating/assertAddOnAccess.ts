import { type AddOnKey, ADD_ON_LABELS, tenantHasAddOn } from '@alga-psa/types';
import { getSession } from '@alga-psa/auth';
import { isEnterprise } from '../features';
import { getActiveAddOns } from './getActiveAddOns';

export class AddOnAccessError extends Error {
  public readonly addOn: AddOnKey;

  constructor(addOn: AddOnKey) {
    super(`This feature requires the ${ADD_ON_LABELS[addOn]} add-on.`);
    this.name = 'AddOnAccessError';
    this.addOn = addOn;
  }
}

/**
 * Server-side assertion that throws if the current tenant doesn't have access to an add-on.
 */
export async function assertAddOnAccess(addOn: AddOnKey): Promise<void> {
  if (!isEnterprise) return;

  const session = await getSession();
  const tenantId = session?.user?.tenant;
  const addOns = tenantId ? await getActiveAddOns(tenantId) : (session?.user?.addons ?? []);

  if (!tenantHasAddOn(addOns, addOn)) {
    throw new AddOnAccessError(addOn);
  }
}
