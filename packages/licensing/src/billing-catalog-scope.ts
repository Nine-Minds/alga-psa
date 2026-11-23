/** Light entry for the billing catalog request scope (withAuth, the server render slot, the EE offer catalog's per-request reads) without the full licensing index. */
export {
  runWithBillingCatalogRequest, hasBillingCatalogScope, registerBillingCatalogRenderScope,
  memoiseInBillingCatalogRequest, forgetBillingCatalogRequest,
} from './lib/co-managed-purchase-surface';
