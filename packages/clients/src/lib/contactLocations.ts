/**
 * The contact-location row attacher, re-exported here as the sibling of `attachDisplayTags` the
 * client actions reach for. The implementation lives in shared/models so the ticket paths can use
 * the same one without depending on packages/clients.
 */
export {
  attachContactLocations,
  type WithContactLocations,
} from '@alga-psa/shared/models/contactLocation';
