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

export interface RmmProviderMetadata {
  id: RmmProvider;
  title: string;
  description: string;
  icon: 'tacticalrmm' | 'ninjaone' | 'tanium' | 'levelio' | 'huntress';
  badge?: RmmProviderBadge;
  capabilities: RmmProviderCapabilityFlags;
  requiresEnterprise: boolean;
}

export interface RmmProviderAvailabilityContext {
  isEnterprise: boolean;
}

const RMM_PROVIDER_REGISTRY: RmmProviderMetadata[] = [
  {
    id: 'tacticalrmm',
    title: 'Tactical RMM',
    description: 'Sync devices and ingest alerts via Tactical RMM (beta API + alert-action webhooks).',
    icon: 'tacticalrmm',
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: true
    },
    requiresEnterprise: false
  },
  {
    id: 'ninjaone',
    title: 'NinjaOne',
    description: 'Sync devices, receive alerts, and enable remote access.',
    icon: 'ninjaone',
    badge: { label: 'Enterprise', variant: 'secondary' },
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
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: false,
      remoteActions: false
    },
    requiresEnterprise: true
  },
  {
    id: 'levelio',
    title: 'Level',
    description: 'Sync devices and groups from Level (level.io) with alert ingestion via automation webhooks.',
    icon: 'levelio',
    badge: { label: 'Enterprise', variant: 'secondary' },
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: false
    },
    requiresEnterprise: true
  },
  {
    id: 'huntress',
    title: 'Huntress',
    description: 'Managed security: SOC-reviewed incident reports become tickets automatically.',
    icon: 'huntress',
    badge: { label: 'Enterprise', variant: 'secondary' },
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: false,
      events: false,
      remoteActions: false
    },
    requiresEnterprise: true
  }
];

export function getAvailableRmmProviderRegistry(
  context: RmmProviderAvailabilityContext
): RmmProviderMetadata[] {
  return RMM_PROVIDER_REGISTRY.filter((provider) => {
    if (provider.requiresEnterprise && !context.isEnterprise) {
      return false;
    }

    return true;
  });
}

export function getRmmProviderMetadata(providerId: RmmProvider): RmmProviderMetadata | undefined {
  return RMM_PROVIDER_REGISTRY.find((provider) => provider.id === providerId);
}

export { RMM_PROVIDER_REGISTRY };
