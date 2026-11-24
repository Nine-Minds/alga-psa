/**
 * Server-only licensing database operations.
 *
 * Keep tenant-parameter queries behind this subpath so client bundles cannot
 * import them through the general licensing engine.
 */
import 'server-only';

export * from './lib/get-license-usage';
