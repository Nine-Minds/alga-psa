import type { ICreditExpirationSettings, ICreditTracking } from '@alga-psa/types';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCreditExpirationSettings } from '../../actions/creditExpirationSettingsActions';
import { listCredits } from './actions';
import CreditsPageClient from './CreditsPageClient';

type CreditRow = ICreditTracking & {
  transaction_description?: string;
  invoice_number?: string;
  client_name?: string;
};

interface CreditsListResult {
  success: boolean;
  data?: {
    credits: CreditRow[];
  };
  error?: string;
}

type CreditExpirationSettingsResult = ICreditExpirationSettings | ActionMessageError | ActionPermissionError;

export default async function CreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId?: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const requestedClientId = resolvedParams.clientId || resolvedSearchParams.client;
  // The expiration settings fall back to tenant defaults for an unknown client,
  // so keep the zero-UUID sentinel there; the credits list itself should show
  // every client's credits when no specific client was requested.
  const clientId = requestedClientId || '00000000-0000-0000-0000-000000000000';

  const [settings, activeCreditsResult, allCreditsResult]: [
    CreditExpirationSettingsResult,
    CreditsListResult,
    CreditsListResult,
  ] = await Promise.all([
    getCreditExpirationSettings(clientId),
    listCredits(requestedClientId || undefined, false),
    listCredits(requestedClientId || undefined, true),
  ]);

  return (
    <CreditsPageClient
      settings={settings}
      activeCreditsResult={activeCreditsResult}
      allCreditsResult={allCreditsResult}
    />
  );
}
