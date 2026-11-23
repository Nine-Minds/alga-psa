// The resolver lives in @alga-psa/email so the packages that send their own mail (quotes) share
// it with the server's event emails instead of keeping a private tenant-then-system lookup.
export {
  lookupEmailTemplate,
  type EmailTemplateRow,
  type EmailTemplateSource,
} from '@alga-psa/email/templateLookup';
