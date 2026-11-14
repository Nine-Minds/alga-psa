// The portal billing-access checks live in @alga-psa/billing so the portal and the
// quote decision service share one rule.
export {
  getClientIdFromPortalUser,
  hasClientBillingReadPermission,
} from '@alga-psa/billing/lib/clientPortalAccess';
