import logger from '@alga-psa/core/logger';
import { loadEnterpriseServiceRequestProviderRegistrations } from './enterpriseEntry';
import { registerServiceRequestProviders } from './registry';

export async function registerEnterpriseServiceRequestProviders(): Promise<void> {
  try {
    const registrations = await loadEnterpriseServiceRequestProviderRegistrations();
    if (!registrations) {
      logger.info('[service-requests] no enterprise provider registrations found');
      return;
    }

    registerServiceRequestProviders(registrations);
    logger.info('[service-requests] registered enterprise provider extensions');
  } catch (error) {
    logger.error('[service-requests] failed to register enterprise provider extensions', { error });
  }
}
