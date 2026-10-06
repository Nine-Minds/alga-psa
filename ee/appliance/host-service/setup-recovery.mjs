/**
 * Classify a blocked install-code redemption and build the recovery advice the
 * status UI shows.
 *
 * A `redeem-install-code` failure has three meaningfully different causes:
 *   - a confirmed code problem (invalid / expired / already used) — the code
 *     will never work, so the operator must re-issue a fresh one;
 *   - a transport problem with network evidence (DNS / TLS / socket) — the code
 *     may still be valid, so blaming it is misleading and the operator must fix
 *     connectivity; and
 *   - a non-code, non-network failure with no transport evidence (for example an
 *     invalid license-service URL or a refused redemption redirect) — neither the
 *     code nor the network is proven at fault, so guidance stays neutral.
 *
 * The setup engine marks a confirmed code problem with `failure.correctable`
 * (see `install-code.mjs` FRIENDLY_ERRORS) and attaches the transport's
 * structured `failure.network` detail for reachability failures.
 */

export const INSTALL_CODE_STEP = 'redeem-install-code';
const REISSUE_URL = 'nineminds.com/order/appliance/reissue';

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.length > 0) : [];
}

// Builds the transport diagnostic. The addresses the FAILED CONNECTION used are
// shown as such; the addresses from the engine's later explicit diagnostic
// lookup are labelled separately, because that lookup bypasses the search walk
// and can return a healthy public address while the connection itself followed a
// customer search domain to the wrong (wildcard) address.
function buildNetworkDiagnostic({ hostname, dnsServers, lookupAddresses, resolvedAddresses, dnsOk, dnsError, socketCode }) {
  const failureParts = [];
  if (hostname) failureParts.push(`Destination ${hostname}`);
  if (dnsServers.length) failureParts.push(`DNS servers ${dnsServers.join(', ')}`);
  if (lookupAddresses.length) {
    failureParts.push(`the failed connection used ${lookupAddresses.join(', ')}`);
  } else {
    failureParts.push('the failed connection resolved no address');
  }
  if (socketCode) failureParts.push(`socket/TLS code ${socketCode}`);

  const laterParts = [];
  if (resolvedAddresses.length) {
    laterParts.push(`a later diagnostic lookup returned ${resolvedAddresses.join(', ')}`);
  } else if (dnsOk === false || dnsError) {
    laterParts.push(`a later diagnostic lookup also failed${dnsError ? `: ${dnsError}` : ''}`);
  }

  return [failureParts.join(' · '), laterParts.join(' · ')].filter(Boolean).join(' · ');
}

function recoveryCopy(kind) {
  if (kind === 'code') {
    return {
      title: 'Install code needs attention',
      body:
        'The install code could not be redeemed — it may be invalid, expired, or already used. ' +
        `Re-issue a fresh code at ${REISSUE_URL} and we will email it to you, then re-enter it to continue.`
    };
  }
  if (kind === 'network') {
    return {
      title: 'Could not reach the licensing service',
      body:
        'The install code could not be redeemed because this appliance could not reach the licensing service. ' +
        'This is a network problem, so your code may still be valid. Check that the appliance can resolve the ' +
        'licensing hostname and make outbound HTTPS connections, then re-enter the code to try again.'
    };
  }
  return {
    title: 'Install code could not be redeemed',
    body:
      'The install code could not be redeemed and the appliance did not report a network problem. ' +
      'Review the detail below and try again; if it keeps failing, contact support.'
  };
}

export function classifySetupRecovery(state) {
  const failure = state && typeof state === 'object' ? state.failure : null;
  if (!failure || typeof failure !== 'object' || failure.step !== INSTALL_CODE_STEP) {
    return null;
  }

  const confirmedCodeError = failure.correctable === true;
  const network = failure.network && typeof failure.network === 'object' ? failure.network : null;
  const hasNetworkEvidence = Boolean(network);
  const kind = confirmedCodeError ? 'code' : (hasNetworkEvidence ? 'network' : 'other');

  const hostname = network?.hostname || null;
  const dnsServers = stringList(network?.servers);
  const lookupAddresses = stringList(network?.lookupAddresses);
  const resolvedAddresses = stringList(network?.addresses);
  const dnsOk = typeof network?.dnsOk === 'boolean' ? network.dnsOk : null;
  const dnsError = network?.dnsError || null;
  const socketCode = network?.code || null;
  const message = failure.message || failure.suspectedCause || null;
  const details = failure.details || null;
  const { title, body } = recoveryCopy(kind);

  let diagnostic = null;
  if (kind === 'network') {
    diagnostic = buildNetworkDiagnostic({ hostname, dnsServers, lookupAddresses, resolvedAddresses, dnsOk, dnsError, socketCode });
  } else if (kind === 'other') {
    diagnostic = details || message;
  }

  return {
    // Either way the operator can re-enter a code; the `/setup` form stays open
    // so they can correct a typo or retry after fixing the cause.
    reEditable: true,
    kind,
    confirmedCodeError,
    hasNetworkEvidence,
    step: INSTALL_CODE_STEP,
    message,
    details,
    hostname,
    dnsServers,
    lookupAddresses,
    resolvedAddresses,
    dnsOk,
    dnsError,
    socketCode,
    title,
    body,
    diagnostic
  };
}
