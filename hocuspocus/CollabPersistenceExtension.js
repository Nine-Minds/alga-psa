import * as Y from 'yjs'

/**
 * Durable persistence for collaborative documents.
 *
 * Hocuspocus only syncs the Y.js document in memory (and across instances via
 * Redis). On its own nothing is written to Postgres, so edits are lost on room
 * eviction. This extension implements `onStoreDocument` — which Hocuspocus
 * calls debounced while editing and again when the last client disconnects —
 * and ships the Y.js state to an internal app endpoint that converts it to
 * ProseMirror JSON and writes it to document_block_content.
 *
 * Only `document:<tenant>:<id>` rooms are persisted. Ticket / notification /
 * AI rooms are ignored. Errors are logged, never thrown: a failed persist must
 * not disrupt the live editing session — Hocuspocus retries on the next
 * debounce / unload.
 *
 * Hocuspocus unloads a room — and resolves `destroy()` on shutdown — without
 * waiting for a store or authorization request that is already in flight, so
 * the extension tracks its own outstanding requests. `settled()` resolves once
 * they have all finished, and `onDestroy` drains them so a graceful shutdown
 * does not cut off the final persist of a room that just unloaded.
 */
export class CollabPersistenceExtension {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'http://localhost:3000/api/internal/collab/persist'
    this.apiKey = config.apiKey || ''
    this.authorizationUrl = config.authorizationUrl || this.apiUrl.replace(/\/persist(?:\?.*)?$/, '/authorize')
    this.roomCredentials = new Map()
    this.inFlight = new Set()
  }

  track(work) {
    this.inFlight.add(work)
    const release = () => { this.inFlight.delete(work) }
    work.then(release, release)
    return work
  }

  async settled() {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight])
    }
  }

  async onDestroy() {
    await this.settled()
  }

  authorizeWriter(documentName, credential) {
    return this.track(this.requestWriterAuthorization(documentName, credential))
  }

  async requestWriterAuthorization(documentName, credential) {
    const [, tenantId, documentId] = documentName.split(':')
    if (!tenantId || !documentId || !credential || !this.apiKey) return false
    try {
      const response = await fetch(this.authorizationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ tenantId, documentId, credential }),
      })
      return response.ok
    } catch (error) {
      console.error(`[CollabPersistenceExtension] authorization check failed for ${documentName}:`, error)
      return false
    }
  }

  async beforeHandleMessage({ documentName, context }) {
    if (!documentName?.startsWith('document:')) return
    const credential = context?.documentRoomToken
    if (!await this.authorizeWriter(documentName, credential)) {
      throw new Error('Document edit authorization expired or was revoked')
    }
  }

  onChange({ documentName, context }) {
    if (documentName?.startsWith('document:') && context?.documentRoomToken) {
      this.roomCredentials.set(documentName, context.documentRoomToken)
    }
  }

  afterUnloadDocument({ documentName }) {
    this.roomCredentials.delete(documentName)
  }

  onStoreDocument(payload) {
    return this.track(this.persistDocument(payload))
  }

  async persistDocument({ document, documentName }) {
    if (!documentName || !documentName.startsWith('document:')) {
      return
    }
    const parts = documentName.split(':')
    if (parts.length !== 3) {
      return
    }
    const [, tenantId, documentId] = parts
    if (!tenantId || !documentId) {
      return
    }

    const fragment = document.getXmlFragment('prosemirror')
    if (!fragment || fragment.length === 0) {
      // Fresh/empty room — don't overwrite stored content before the client
      // has seeded it from the database.
      return
    }

    if (!this.apiKey) {
      console.error('[CollabPersistenceExtension] COLLAB_PERSIST_API_KEY not set; skipping persistence')
      return
    }

    const credential = this.roomCredentials.get(documentName)
    if (!credential) {
      console.error(`[CollabPersistenceExtension] no authenticated writer for ${documentName}; skipping persistence`)
      return
    }

    try {
      const update = Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64')
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ tenantId, documentId, update, credential }),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        console.error(
          `[CollabPersistenceExtension] persist failed ${response.status} for ${documentName}: ${errorBody}`
        )
      }
    } catch (error) {
      console.error(`[CollabPersistenceExtension] persist error for ${documentName}:`, error)
    }
  }
}
