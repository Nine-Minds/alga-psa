import type { ICreditExpirationSettings } from '@alga-psa/types';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCreditExpirationSettings } from '../../actions/creditExpirationSettingsActions';
import CreditsPageClient from './CreditsPageClient';

type CreditExpirationSettingsResult = ICreditExpirationSettings | ActionMessageError | ActionPermissionError;

export default async function CreditsPage() {
  // Expiration settings fall back to tenant defaults when no client matches,
  // so the zero-UUID sentinel yields the tenant-wide policy shown on this page.
  const settings: CreditExpirationSettingsResult = await getCreditExpirationSettings(
    '00000000-0000-0000-0000-000000000000'
  );

  return <CreditsPageClient settings={settings} />;
}
