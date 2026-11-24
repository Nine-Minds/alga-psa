import { parseTicketRoom, validateDocumentRoomAccess } from './tenantValidation.js'

/** Validate upgrade-time room context. Ticket-list rooms use protocol authentication. */
export async function resolveDocumentConnectionContext(data) {
  if (data.documentName?.startsWith('tenant:') && data.documentName.endsWith(':ticket-changes')) return undefined
  await validateDocumentRoomAccess(data.documentName, data.request)
  return undefined
}

/** The authentication hook's returned context is propagated to connected hooks. */
export async function resolveDocumentAuthenticationContext(data) {
  if (data.documentName?.startsWith('tenant:') && data.documentName.endsWith(':ticket-changes')) {
    const access = validateDocumentRoomAccess(data.documentName, data.request, { token: data.token })
    return { ticketChangesAccess: access }
  }
  const access = await validateDocumentRoomAccess(data.documentName, data.request)
  if (parseTicketRoom(data.documentName)) return { ticketAccess: access }
  return undefined
}
