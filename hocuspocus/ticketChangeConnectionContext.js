import { validateDocumentRoomAccess } from './tenantValidation.js'

/** Validate upgrade-time room context; ticket rooms wait for protocol authentication. */
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
  await validateDocumentRoomAccess(data.documentName, data.request)
  return undefined
}
