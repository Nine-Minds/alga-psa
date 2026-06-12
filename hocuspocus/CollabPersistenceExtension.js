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
 */
export class CollabPersistenceExtension {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'http://localhost:3000/api/internal/collab/persist'
    this.apiKey = config.apiKey || ''
  }

  async onStoreDocument({ document, documentName }) {
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

    try {
      const update = Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64')
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ tenantId, documentId, update }),
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
