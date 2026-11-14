/**
 * The acceptance wording a recipient agrees to when accepting a quote through an
 * email link, and its version. This is the single definition: the server hashes
 * exactly this text (see quoteLinkDecisionService) and the public decision panel
 * displays exactly this text. Change the wording => bump the version.
 *
 * The wording is deliberately NOT routed through i18n: the stored hash must
 * identify the precise text that was shown, so it is one canonical, versioned string.
 *
 * No Node imports here: this module is safe to bundle into client components.
 */
export const QUOTE_ACCEPTANCE_AGREEMENT_VERSION = '2026-10-31.1';

export const QUOTE_ACCEPTANCE_AGREEMENT_TEXT =
  'I have reviewed this quote and I am authorized to accept it on behalf of my organization. ' +
  'I understand that typing my full name below is my electronic signature and has the same effect as a handwritten signature.';
