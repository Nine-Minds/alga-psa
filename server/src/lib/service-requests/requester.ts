/**
 * The party a service request is filed for, plus (optionally) who typed it in.
 *
 * Visibility providers, audience predicates, `contextDefaults` placeholders and the
 * ticket's contact all evaluate the *requester*. The submitter is recorded alongside
 * and never substitutes for the requester.
 */
export interface ServiceRequestRequester {
  clientId: string;
  contactId: string;
  /** The contact's portal user, when one exists. NEVER the technician. */
  requesterUserId: string | null;
  /** The MSP user who filed it; null when the requester filed it themselves. */
  submittedByUserId: string | null;
}
