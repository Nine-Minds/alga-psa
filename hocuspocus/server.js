import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { Database } from '@hocuspocus/extension-database'
import { Logger } from '@hocuspocus/extension-logger'
import pg from 'pg'
import { createDirectMessagePersistenceExtension } from './extensions/directMessagePersistence.js'


// Create PostgreSQL client for direct message persistence
const pgClient = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'alga_psa_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'sebastian123',
});

// Connect to PostgreSQL
pgClient.connect().catch(console.error);

const server = Server.configure({
    port: process.env.PORT || 1234,
    extensions: [
        new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            options: {
                password: process.env.REDIS_PASSWORD || 'sebastian123'
            },
        }),
        new Database({
            type: 'DB',
            host: process.env.DB_HOST ||  'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME_HOCUSPOCUS || 'hocuspocus',
            username: process.env.DB_USER_HOCUSPOCUS || 'postrgres',
            password: process.env.DB_PASSWORD_HOCUSPOCUS || 'sebastian123',
        }),
        createDirectMessagePersistenceExtension(pgClient),
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