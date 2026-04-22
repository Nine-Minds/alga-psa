import type { ICreditExpirationSettings, ICreditTracking } from '@alga-psa/types';
import { getCreditExpirationSettings } from '../../actions/creditExpirationSettingsActions';
import { listCredits } from './actions';
import CreditsPageClient from './CreditsPageClient';

type CreditRow = ICreditTracking & {
  transaction_description?: string;
  invoice_number?: string;
};

interface CreditsListResult {
  success: boolean;
  data?: {
    credits: CreditRow[];
  };
  error?: string;
}

export default async function CreditsPage({ params }: { params: Promise<{ clientId?: string }> }) {
  const resolvedParams = await params;
  const clientId = resolvedParams.clientId || '00000000-0000-0000-0000-000000000000';

  const [settings, activeCreditsResult, allCreditsResult]: [
    ICreditExpirationSettings,
    CreditsListResult,
    CreditsListResult,
  ] = await Promise.all([
    getCreditExpirationSettings(clientId),
    listCredits(clientId, false),
    listCredits(clientId, true),
  ]);

  return (
    <CreditsPageClient
      settings={settings}
      activeCreditsResult={activeCreditsResult}
      allCreditsResult={allCreditsResult}
    />
  );
}
