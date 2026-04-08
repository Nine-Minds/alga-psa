import type { RmmProvider } from '@alga-psa/types';

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
    case 'connectwise_automate':
      return 'CW Automate';
    default:
      return provider || 'Unknown';
  }
}
