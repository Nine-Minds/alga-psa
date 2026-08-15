/**
 * The canonical extension gateway access policy is owned by the
 * `@product/ext-proxy` package so that both the direct `/api/ext` gateway
 * (this project) and the ext-proxy handler (the package) can consume a single
 * fail-closed decision without a `server <-> @product/ext-proxy` import cycle.
 *
 * This module re-exports that policy for existing server-side importers.
 */
export {
  assertAccess,
  ExtensionGatewayAccessError,
} from '@product/ext-proxy/ee/gateway/access';
export type {
  AssertExtensionAccessInput,
  AuthorizedExtensionAccess,
  ExtensionGatewayAccessErrorCode,
  ExtensionGatewayPrincipal,
} from '@product/ext-proxy/ee/gateway/access';
