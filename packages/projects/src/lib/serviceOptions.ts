import type { IService } from '@alga-psa/types';
import { getServices } from '../actions/serviceCatalogActions';

/**
 * The service catalog for a project form's service picker, or an empty list when the lookup fails.
 *
 * The catalog is a commercial lookup: it is refused to a subject without `service:read` or
 * `billing:read` (`@alga-psa/auth/lib/commercialAccess`), such as a seat technician or a role an
 * administrator created without it. The picker is optional on every project form, so a refusal
 * must leave the form usable rather than abort the rest of its loading.
 */
export async function loadServiceOptions(): Promise<IService[]> {
  try {
    const response = await getServices(1, 999);
    return response.services;
  } catch (error) {
    console.warn('Service catalog unavailable for this user; the service picker is left empty.', error);
    return [];
  }
}
