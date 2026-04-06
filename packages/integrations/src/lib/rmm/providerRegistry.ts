import type { RmmProvider } from '@alga-psa/types';

export interface RmmProviderCapabilityFlags {
  connection: boolean;
  scopeSync: boolean;
  deviceSync: boolean;
  events: boolean;
  remoteActions: boolean;
}

export interface RmmProviderBadge {
  label: string;
  variant: 'default' | 'secondary' | 'outline';
}

export interface RmmProviderHighlight {
  label: string;
  value: string;
}

export interface RmmProviderMetadata {
  id: RmmProvider;
  title: string;
  description: string;
  icon: 'tacticalrmm' | 'ninjaone' | 'tanium';
  badge?: RmmProviderBadge;
  highlights: RmmProviderHighlight[];
  capabilities: RmmProviderCapabilityFlags;
  requiresEnterprise: boolean;
  featureFlagKey?: 'tactical-rmm-integration' | 'tanium-rmm-integration';
}

export interface RmmProviderAvailabilityContext {
  isEnterprise: boolean;
  enabledFeatureFlags: Partial<Record<'tactical-rmm-integration' | 'tanium-rmm-integration', boolean>>;
}

const RMM_PROVIDER_REGISTRY: RmmProviderMetadata[] = [
  {
    id: 'tacticalrmm',
    title: 'Tactical RMM',
    description: 'Sync devices and ingest alerts via Tactical RMM (beta API + alert-action webhooks).',
    icon: 'tacticalrmm',
    highlights: [
      { label: 'Sync', value: 'Devices' },
      { label: 'Realtime', value: 'Alerts' }
    ],
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: true
    },
    requiresEnterprise: false,
    featureFlagKey: 'tactical-rmm-integration'
  },
  {
    id: 'ninjaone',
    title: 'NinjaOne',
    description: 'Sync devices, receive alerts, and enable remote access (Enterprise).',
    icon: 'ninjaone',
    badge: { label: 'Enterprise', variant: 'secondary' },
    highlights: [
      { label: 'Sync', value: 'Devices' },
      { label: 'Realtime', value: 'Webhooks' }
    ],
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: true
    },
    requiresEnterprise: true
  },
  {
    id: 'tanium',
    title: 'Tanium',
    description: 'Gateway-first inventory sync with scope discovery and capability-gated advanced actions.',
    icon: 'tanium',
    badge: { label: 'Enterprise', variant: 'secondary' },
    highlights: [
      { label: 'Sync', value: 'Inventory' },
      { label: 'Scopes', value: 'Computer Groups' }
    ],
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: false,
      remoteActions: false
    },
    requiresEnterprise: true,
    featureFlagKey: 'tanium-rmm-integration'
  }
];

export function getAvailableRmmProviderRegistry(
  context: RmmProviderAvailabilityContext
): RmmProviderMetadata[] {
  return RMM_PROVIDER_REGISTRY.filter((provider) => {
    if (provider.requiresEnterprise && !context.isEnterprise) {
      return false;
    }

    if (provider.featureFlagKey && !context.enabledFeatureFlags[provider.featureFlagKey]) {
      return false;
    }

    return true;
  });
}

export function getRmmProviderMetadata(providerId: RmmProvider): RmmProviderMetadata | undefined {
  return RMM_PROVIDER_REGISTRY.find((provider) => provider.id === providerId);
}

export { RMM_PROVIDER_REGISTRY };
