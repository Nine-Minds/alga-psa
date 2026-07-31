import type { ICreditExpirationSettings } from '@alga-psa/types';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCreditExpirationSettings } from '../../actions/creditExpirationSettingsActions';
import CreditsPageClient from './CreditsPageClient';

type CreditExpirationSettingsResult = ICreditExpirationSettings | ActionMessageError | ActionPermissionError;

export default async function CreditsPage() {
  // Tenant-wide expiration policy for the caption line.
  const settings: CreditExpirationSettingsResult = await getCreditExpirationSettings(null);

  return <CreditsPageClient settings={settings} />;
}
