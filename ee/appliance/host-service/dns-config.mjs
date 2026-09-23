/**
 * Resolver-configuration identity for setup DNS admission.
 *
 * Setup admission must be tied to the *intended resolver configuration*, not to
 * wall-clock time. A host activation that was submitted for one configuration can
 * complete after the operator changed the inputs; comparing timestamps lets that
 * older completion authorize the new configuration. Instead, submission, host
 * activation, completion and admission all carry a fingerprint derived from the
 * same persisted setup inputs, and an activation recorded for different inputs
 * can never release the gate.
 *
 * The host helper (`ee/appliance/scripts/configure-k3s-dns.sh`) computes the same
 * string from the same setup-inputs file with an inline Node script; a regression
 * test runs the real helper and asserts equality, so the two cannot drift.
 *
 * Pure: no fs/network access, so it is directly unit-testable.
 */
import crypto from 'node:crypto';

// Environment variable the control plane passes (launcher -> Job -> host unit) so
// the host helper can assert the activation it is about to record is the one the
// control plane submitted for.
export const DNS_CONFIG_FINGERPRINT_ENV = 'ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT';

export function normalizeDnsMode(value) {
  return String(value ?? '').trim().toLowerCase() === 'custom' ? 'custom' : 'system';
}

export function normalizeDnsServers(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * Fingerprint of the requested DNS configuration. `system` mode only depends on
 * the mode (host upstreams are read by the helper at activation time); `custom`
 * mode depends on the ordered, normalized operator server list. This is the
 * identity compared by setup admission.
 */
export function dnsConfigurationFingerprint(inputs = {}) {
  const mode = normalizeDnsMode(inputs.dnsMode);
  const servers = mode === 'custom' ? normalizeDnsServers(inputs.dnsServers) : [];
  return crypto.createHash('sha256').update(`${mode}\n${servers.join('\n')}`).digest('hex');
}
