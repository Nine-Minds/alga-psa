import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { Database } from '@hocuspocus/extension-database'
import { Logger } from '@hocuspocus/extension-logger'
import { NotificationExtension } from './NotificationExtension.js'

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
        new Database({
            type: 'DB',
            host: process.env.DB_HOST ||  'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME_HOCUSPOCUS || 'hocuspocus',
            username: process.env.DB_USER_HOCUSPOCUS || 'hocuspocus_user',
            password: getEnvOrFail('DB_PASSWORD_HOCUSPOCUS', 'sebastian123'),
        }),
        new NotificationExtension({
            redisHost: process.env.REDIS_HOST || 'localhost',
            redisPort: process.env.REDIS_PORT || 6379,
            redisUsername: process.env.REDIS_USERNAME || 'default',
            redisPassword: getEnvOrFail('REDIS_PASSWORD', 'sebastian123'),
            redisPrefix: process.env.REDIS_PREFIX || 'alga-psa:'
        }),
        new Logger({
            level: 'debug', // Set to 'debug' for maximum verbosity
          }),
    ],
    })

// const server = Server.configure({
//     port: 1234,
//     extensions: [
//       new Logger(),
//     ],
//   })
  
server.listen()
