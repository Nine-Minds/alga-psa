import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { Logger } from '@hocuspocus/extension-logger'
import { NotificationExtension } from './NotificationExtension.js'
import { TicketUpdatesExtension } from './TicketUpdatesExtension.js'
import { AiParticipantExtension } from './AiParticipantExtension.js'
import { CollabPersistenceExtension } from './CollabPersistenceExtension.js'
import { validateDocumentRoomAccess } from './tenantValidation.js'

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
        new CollabPersistenceExtension({
            apiUrl: process.env.COLLAB_PERSIST_API_URL || 'http://localhost:3000/api/internal/collab/persist',
            apiKey: process.env.COLLAB_PERSIST_API_KEY || '',
        }),
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
            redisPrefix: process.env.REDIS_PREFIX || 'alga-psa:'
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
        validateDocumentRoomAccess(data.documentName, data.request);
    },
    })

// const server = Server.configure({
//     port: 1234,
//     extensions: [
//       new Logger(),
//     ],
//   })
  
server.listen()
