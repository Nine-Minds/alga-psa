// The normalizer lives in @alga-psa/formatting so the server paths (inbound
// email conversion, outbound comment emails) can share it. Re-exported here so
// the editor components keep their local import.
export { splitEmbeddedNewlineBlocks } from '@alga-psa/formatting/normalizeBlocks';
