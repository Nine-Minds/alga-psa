import { getSecret } from '../utils/getSecret.js';
import logger from '@shared/core/logger';

export async function testRedisSecret() {
  try {
    logger.info('Testing Redis secret retrieval...');
    
    const redisPassword = await getSecret('redis_password', 'REDIS_PASSWORD');
    
    logger.info('Redis secret test results:', {
      passwordLength: redisPassword?.length || 0,
      passwordExists: !!redisPassword,
      passwordValue: redisPassword ? `${redisPassword.substring(0, 3)}***` : 'null/undefined'
    });
    
    // Test environment variable fallback
    const envRedisPassword = process.env.REDIS_PASSWORD;
    logger.info('Environment variable REDIS_PASSWORD:', {
      exists: !!envRedisPassword,
      value: envRedisPassword ? `${envRedisPassword.substring(0, 3)}***` : 'null/undefined'
    });
    
    return redisPassword;
  } catch (error) {
    logger.error('Error testing Redis secret:', error);
    throw error;
  }
}