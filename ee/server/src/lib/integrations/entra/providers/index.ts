import type { EntraConnectionType } from '../../../../interfaces/entra.interfaces';
import { createCippProviderAdapter } from './cipp/cippProviderAdapter';
import { createDirectProviderAdapter } from './direct/directProviderAdapter';
import type { EntraProviderAdapter } from './types';

export function getEntraProviderAdapter(connectionType: EntraConnectionType): EntraProviderAdapter {
  if (connectionType === 'direct') {
    return createDirectProviderAdapter();
  }

  if (connectionType === 'cipp') {
    return createCippProviderAdapter();
  }

  throw new Error(`Unsupported Entra connection type: ${connectionType}`);
}
