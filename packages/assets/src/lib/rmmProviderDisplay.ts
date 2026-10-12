import type { RmmProvider } from '@alga-psa/types';

// LEVERAGE: pattern rmm-provider-registration — hand-maintained provider display map
export function getRmmProviderDisplayName(provider?: RmmProvider | string): string {
  switch (provider) {
    case 'ninjaone':
      return 'NinjaOne';
    case 'tacticalrmm':
      return 'Tactical RMM';
    case 'tanium':
      return 'Tanium';
    case 'datto':
      return 'Datto';
    case 'levelio':
      return 'Level';
    case 'unifi':
      return 'UniFi';
    case 'connectwise_automate':
      return 'CW Automate';
    case 'huntress':
      return 'Huntress';
    default:
      return provider || 'Unknown';
  }
}
