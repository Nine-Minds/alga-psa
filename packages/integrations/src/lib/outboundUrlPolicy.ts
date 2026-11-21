/** Integrations compatibility entry point for the shared outbound policy. */
export {
  assertSafeOutboundHost,
  assertSafeOutboundUrl,
  isBlockedOutboundAddress,
  normalizeOutboundHostname,
  UnsafeOutboundAddressError,
  UnsafeOutboundUrlError,
} from '@alga-psa/shared/services/net/outboundAddressPolicy';
