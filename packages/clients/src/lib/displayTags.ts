// Implementation lives in @alga-psa/tags so packages that may not depend on
// @alga-psa/clients (e.g. tickets) can attach chip tags to their own picker rows.
// Re-exported here for the existing clients call sites.
export { attachDisplayTags } from '@alga-psa/tags/lib/displayTags';
