/**
 * Precedence resolver for the default service used on a new ticket time entry.
 *
 * Candidates are tried in order — per-client default first, then the tenant
 * default — and the first one that the caller's `validate` predicate accepts
 * wins. The predicate is responsible for every rule that makes a service
 * usable (still exists, active, an hourly time-entry service, applicable to the
 * client). When no candidate validates, the resolver returns a null service so
 * the existing required-field behavior is preserved.
 *
 * The predicate is injected so the precedence and fall-through rules can be
 * tested without a database; the server action supplies the real validator.
 * Per-user last-used defaulting is intentionally not part of this resolver: it
 * was not part of the approved scope.
 */
export type DefaultTimeEntryServiceSource = 'client' | 'tenant';

export interface ResolvedDefaultTimeEntryService {
  serviceId: string | null;
  source: DefaultTimeEntryServiceSource | null;
}

export interface ResolveDefaultTimeEntryServiceParams {
  clientDefaultServiceId?: string | null;
  tenantDefaultServiceId?: string | null;
  validate: (serviceId: string) => Promise<boolean> | boolean;
}

export async function resolveDefaultTimeEntryService(
  params: ResolveDefaultTimeEntryServiceParams
): Promise<ResolvedDefaultTimeEntryService> {
  const candidates: Array<{ serviceId: string; source: DefaultTimeEntryServiceSource }> = [];

  if (params.clientDefaultServiceId) {
    candidates.push({ serviceId: params.clientDefaultServiceId, source: 'client' });
  }
  if (params.tenantDefaultServiceId) {
    candidates.push({ serviceId: params.tenantDefaultServiceId, source: 'tenant' });
  }

  for (const candidate of candidates) {
    if (await params.validate(candidate.serviceId)) {
      return { serviceId: candidate.serviceId, source: candidate.source };
    }
  }

  return { serviceId: null, source: null };
}
