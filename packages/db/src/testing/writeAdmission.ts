import {
  registerWriteAdmissionResolver,
  resetWriteAdmissionCache,
  type WriteAdmissionResolver,
} from '../lib/writeAdmission';

/** Forget the negative set, decision cache and per-tenant warnings. */
export function clearWriteAdmissionCacheForTests(): void {
  resetWriteAdmissionCache();
}

/**
 * Run `work` with `resolver` registered, then restore the previous resolver and
 * a clean cache. The resolver is only consulted for tenants whose
 * `tenants.product_code` is `co_managed`.
 */
export async function withTestWriteAdmission<T>(resolver: WriteAdmissionResolver, work: () => Promise<T>): Promise<T> {
  const previous = globalThis.__algaWriteAdmissionResolver;
  clearWriteAdmissionCacheForTests();
  registerWriteAdmissionResolver(resolver);
  try {
    return await work();
  } finally {
    globalThis.__algaWriteAdmissionResolver = previous;
    clearWriteAdmissionCacheForTests();
  }
}
