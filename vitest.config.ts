import path from 'path';
import dotenv from 'dotenv';
import serverConfig from './server/vitest.config';

// Ensure local test environment variables are loaded when running from the repo root,
// which mirrors the env setup used by the server package scripts.
dotenv.config({ path: path.resolve(__dirname, '.env.localtest') });

export default serverConfig;
