/**
 * Classify a blocked install-code redemption so the status UI can give the
 * operator the right recovery advice.
 *
 * A `redeem-install-code` failure has two very different causes:
 *   - a confirmed code problem (invalid / expired / already used): the code will
 *     never work, so the operator must re-issue a fresh one; and
 *   - a transport problem (DNS / TLS / socket): the code may still be valid, so
 *     blaming it is misleading and the operator must fix connectivity instead.
 *
 * The setup engine marks a confirmed code problem with `failure.correctable`
 * (see `install-code.mjs` FRIENDLY_ERRORS). Everything else on the
 * `redeem-install-code` step is treated as transport-class, so a connection
 * failure can never be presented as a bad code.
 */

export const INSTALL_CODE_STEP = 'redeem-install-code';

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.length > 0) : [];
}

export function classifySetupRecovery(state) {
  const failure = state && typeof state === 'object' ? state.failure : null;
  if (!failure || typeof failure !== 'object' || failure.step !== INSTALL_CODE_STEP) {
    return null;
  }

  const confirmedCodeError = failure.correctable === true;
  const network = failure.network && typeof failure.network === 'object' ? failure.network : null;
  const hostname = network?.hostname || null;

  return {
    // Either way the operator can re-enter a code; the `/setup` form stays open
    // so they can correct a typo or retry after fixing the network.
    reEditable: true,
    kind: confirmedCodeError ? 'code' : 'network',
    confirmedCodeError,
    step: INSTALL_CODE_STEP,
    message: failure.message || failure.suspectedCause || null,
    details: failure.details || null,
    hostname,
    dnsServers: stringList(network?.servers),
    lookupAddresses: stringList(network?.lookupAddresses),
    resolvedAddresses: stringList(network?.addresses),
    dnsOk: typeof network?.dnsOk === 'boolean' ? network.dnsOk : null,
    dnsError: network?.dnsError || null,
    socketCode: network?.code || null
  };
}
