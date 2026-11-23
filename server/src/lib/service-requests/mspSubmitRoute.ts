export const MSP_SUBMIT_SERVICE_REQUEST_PATH = '/msp/service-requests/submit';

/** Deep link into the on-behalf-of page; every param prefills that step of the flow. */
export function buildMspSubmitServiceRequestHref(
  prefill: { clientId?: string | null; contactId?: string | null; definitionId?: string | null } = {}
): string {
  const search = new URLSearchParams();
  if (prefill.clientId) search.set('clientId', prefill.clientId);
  if (prefill.contactId) search.set('contactId', prefill.contactId);
  if (prefill.definitionId) search.set('definitionId', prefill.definitionId);
  const query = search.toString();
  return query ? `${MSP_SUBMIT_SERVICE_REQUEST_PATH}?${query}` : MSP_SUBMIT_SERVICE_REQUEST_PATH;
}
