import type { ServiceRequestProviderRegistrations } from './contracts';

export async function loadEnterpriseServiceRequestProviderRegistrations(): Promise<ServiceRequestProviderRegistrations | null> {
  try {
    const mod = await import('@enterprise/lib/service-requests/providers');
    const registerFn = (mod as any).getServiceRequestEnterpriseProviderRegistrations;
    if (typeof registerFn !== 'function') {
      return null;
    }

    const registrations = await registerFn();
    if (!registrations || typeof registrations !== 'object') {
      return null;
    }

    return registrations as ServiceRequestProviderRegistrations;
  } catch {
    return null;
  }
}
