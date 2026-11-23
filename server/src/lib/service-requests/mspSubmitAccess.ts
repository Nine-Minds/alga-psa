import { resolveCurrentUserGrants } from '../auth/currentUserGrants';
import { grantsAllPermissions, MSP_SUBMIT_PERMISSION_KEYS } from './mspSubmitPermissions';

/** Whether the signed-in user may submit on behalf of a contact; shared by the page and every entry point. */
export async function currentUserCanSubmitOnBehalf(): Promise<boolean> {
  return grantsAllPermissions(await resolveCurrentUserGrants(MSP_SUBMIT_PERMISSION_KEYS));
}
