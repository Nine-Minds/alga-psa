import { ManagedDomainService } from '../services/ManagedDomainService';
import { registerManagedDomainService } from '@alga-psa/shared/workflow/services/managedDomainRegistry';

// Register with shared workflow registry for cross-module access
// This allows shared/workflow to use ManagedDomainService without importing integrations directly
registerManagedDomainService(ManagedDomainService);

export { ManagedDomainService };
export type { DnsLookupResult } from '@alga-psa/types';
