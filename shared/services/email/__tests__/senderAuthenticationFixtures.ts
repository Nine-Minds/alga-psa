import type { SenderAuthenticationEvidence } from '../../../interfaces/inbound-email.interfaces';

export function verifiedContactEvidence(
  provider: SenderAuthenticationEvidence['provider'],
  domain = 'example.com',
): SenderAuthenticationEvidence {
  return {
    provider,
    author: { authorization: 'confirmation_required', provenance: 'receiving_mailbox_only' },
    contact: { authorization: 'domain_only', provenance: 'aligned_original_mime_dkim', alignedDomains: [domain] },
    dkim: { verified: true, alignedDomains: [domain], reason: 'aligned_signature' },
  };
}

export function verifiedInternalActorEvidence(
  provider: SenderAuthenticationEvidence['provider'],
  domain = 'example.com',
): SenderAuthenticationEvidence {
  return {
    provider,
    author: { authorization: 'internal_actor_attribution', provenance: 'provider_attested_author' },
    contact: { authorization: 'domain_only', provenance: 'aligned_original_mime_dkim', alignedDomains: [domain] },
    dkim: { verified: true, alignedDomains: [domain], reason: 'aligned_signature' },
  };
}

export function unverifiedSenderEvidence(
  provider: SenderAuthenticationEvidence['provider'],
): SenderAuthenticationEvidence {
  return {
    provider,
    author: { authorization: 'confirmation_required', provenance: 'receiving_mailbox_only' },
    contact: { authorization: 'untrusted', provenance: 'missing_or_invalid_dkim', alignedDomains: [] },
    dkim: { verified: false, alignedDomains: [], reason: 'no_aligned_signature' },
  };
}
