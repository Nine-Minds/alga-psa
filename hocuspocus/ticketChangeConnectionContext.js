import { validateDocumentRoomAccess } from './tenantValidation.js'

/** The returned Hocuspocus onConnect context is propagated to connected hooks. */
export async function resolveDocumentConnectionContext(data) {
  const access = await validateDocumentRoomAccess(data.documentName, data.request)
  if (data.documentName?.startsWith('tenant:') && data.documentName.endsWith(':ticket-changes')) {
    return { ticketChangesAccess: access }
  }
  return undefined
}
