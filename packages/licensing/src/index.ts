/**
 * @alga-psa/licensing
 *
 * The package root is the pure licensing engine — safe to compile into any
 * runtime (server, temporal worker, appliance scripts). Next.js server actions
 * live ONLY behind the './actions' subpath: re-exporting them here drags
 * 'next' into non-Next consumers' module graphs, which crash-looped the prod
 * temporal worker (ERR_MODULE_NOT_FOUND). Do not re-add actions to the root.
 */

export * from './lib/get-license-usage';
export * from './lib/license-types';
export * from './lib/verify-license';
export * from './lib/license-state';
export { LICENSE_PUBLIC_KEYS } from './lib/license-keys';
