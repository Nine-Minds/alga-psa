import {validateEnv} from '../../config/envConfig';

// Initialize and validate environment configuration
const validatedEnv = validateEnv();

// Export the validated environment configuration
export default validatedEnv;

// Export individual configurations for specific uses
export const {
  APP_NAME,
  APP_ENV,
  HOST,
  DB_TYPE,
  DB_HOST,
  DB_PORT,
  // Add other commonly used env vars here
} = validatedEnv;
