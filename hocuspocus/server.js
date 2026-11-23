import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { Logger } from '@hocuspocus/extension-logger'
import { NotificationExtension } from './NotificationExtension.js'
import { TicketUpdatesExtension } from './TicketUpdatesExtension.js'
import { AiParticipantExtension } from './AiParticipantExtension.js'
import { CollabPersistenceExtension } from './CollabPersistenceExtension.js'
import { resolveDocumentAuthenticationContext, resolveDocumentConnectionContext } from './ticketChangeConnectionContext.js'
import { parseDocumentRoom, validateDocumentRoomAccess, validateDocumentRoomToken } from './tenantValidation.js'

// Helper function to get required env var or fail in production
function getEnvOrFail(key, fallbackValue = null) {
    const value = process.env[key];
    const isProduction = process.env.NODE_ENV === 'production';

    if (!value && isProduction) {
        console.error(`ERROR: Required environment variable ${key} is not set in production mode`);
        process.exit(1);
    }

    return value || fallbackValue;
}

const persistenceApiUrl = process.env.COLLAB_PERSIST_API_URL || 'http://localhost:3000/api/internal/collab/persist'
const persistenceExtension = new CollabPersistenceExtension({
    apiUrl: persistenceApiUrl,
    authorizationUrl: process.env.COLLAB_AUTHORIZE_API_URL || persistenceApiUrl.replace(/\/persist(?:\?.*)?$/, '/authorize'),
    apiKey: process.env.COLLAB_PERSIST_API_KEY || '',
})

const server = Server.configure({
    port: process.env.PORT || 1234,
    // Coalesce onStoreDocument: persist ~2s after the last edit, and force a
    // flush at most every 15s during continuous editing. Hocuspocus also fires
    // onStoreDocument when the last client disconnects.
    debounce: Number(process.env.COLLAB_PERSIST_DEBOUNCE_MS || 2000),
    maxDebounce: Number(process.env.COLLAB_PERSIST_MAX_DEBOUNCE_MS || 15000),
    extensions: [
        // redisExtension,
        new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            options: {
                username: process.env.REDIS_USERNAME || 'default',
                password: getEnvOrFail('REDIS_PASSWORD', 'sebastian123')
            },
        }),
        persistenceExtension,
        new NotificationExtension({
            redisHost: process.env.REDIS_HOST || 'localhost',
            redisPort: process.env.REDIS_PORT || 6379,
            redisUsername: process.env.REDIS_USERNAME || 'default',
            redisPassword: getEnvOrFail('REDIS_PASSWORD', 'sebastian123'),
            redisPrefix: process.env.REDIS_PREFIX || 'alga-psa:'
        }),
        new TicketUpdatesExtension({
            redisHost: process.env.REDIS_HOST || 'localhost',
            redisPort: process.env.REDIS_PORT || 6379,
            redisUsername: process.env.REDIS_USERNAME || 'default',
            redisPassword: getEnvOrFail('REDIS_PASSWORD', 'sebastian123'),
            redisPrefix: process.env.REDIS_PREFIX || 'alga-psa:',
            listChangeAuthorizationUrl: process.env.TICKET_LIST_CHANGE_AUTHORIZATION_URL ||
                process.env.COLLAB_PERSIST_API_URL?.replace('/collab/persist', '/tickets/live-change') ||
                'http://server:3000/api/internal/tickets/live-change',
            listChangeApiKey: process.env.COLLAB_PERSIST_API_KEY || '',
        }),
        new AiParticipantExtension({
            aiApiUrl: process.env.AI_DOCUMENT_API_URL || 'http://localhost:3000/api/v1/ai/document-assist',
            aiApiKey: process.env.AI_DOCUMENT_API_KEY || '',
        }),
        new Logger({
            level: 'debug', // Set to 'debug' for maximum verbosity
          }),
    ],
    async onConnect(data) {
        if (parseDocumentRoom(data.documentName)) {
            await validateDocumentRoomAccess(data.documentName, data.request, {
                credential: data.context?.documentRoomToken,
                allowPendingAuthentication: true,
            });
            return undefined;
        }
        return resolveDocumentConnectionContext(data);
    },
    async onAuthenticate(data) {
        const { documentName, token } = data;
        if (parseDocumentRoom(documentName)) {
            const admission = validateDocumentRoomToken(documentName, token)
            if (!await persistenceExtension.authorizeWriter(documentName, token)) {
                throw new Error('Document edit authorization denied')
            }
            return { ...admission, documentRoomToken: token }
        }
        return resolveDocumentAuthenticationContext(data);
    },
    })

// const server = Server.configure({
//     port: 1234,
//     extensions: [
//       new Logger(),
//     ],
//   })
  
server.listen()
