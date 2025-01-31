import crypto from 'crypto';
import { getSecret } from '../../lib/utils/getSecret';

export async function hashPassword(password: string) {
  const key = await getSecret('alga_auth_key', 'ALGA_AUTH_KEY', 'defaultKey');
  const saltBytes= Number(process.env.SALT_BYTES) || 12;
  const iterations = Number(process.env.ITERATIONS) || 1000;
  const keyLength = Number(process.env.KEY_LENGTH) ||64;
  const digest = process.env.ALGORITHM || 'sha512';

  const salt = crypto.randomBytes(saltBytes).toString('hex');
  const hash = crypto.pbkdf2Sync(password, key + salt, iterations, keyLength, digest).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const key = await getSecret('alga_auth_key', 'ALGA_AUTH_KEY', 'defaultKey');
  const iterations = Number(process.env.ITERATIONS) || 1000;
  const keyLength = Number(process.env.KEY_LENGTH) ||64;
  const digest = process.env.ALGORITHM || 'sha512';

  console.log('Starting password verification process');

  if (!password || !storedHash) {
    console.warn('Password verification failed: Missing password or stored hash');
    return false;
  }

  try {
    console.log('Splitting stored hash to extract salt and original hash');
    const [salt, originalHash] = storedHash.split(':');

    if (!salt || !originalHash) {
      console.warn('Password verification failed: Invalid stored hash format');
      return false;
    }

    console.log(`Using parameters: iterations=${iterations}, keyLength=${keyLength}, digest=${digest}`);
    console.log('Generating hash from provided password');
    console.log(`key: ${key}`);
    const hash = crypto.pbkdf2Sync(password, key + salt, iterations, keyLength, digest).toString('hex');

    const isMatch = hash === originalHash;
    console.log(`Password verification result: ${isMatch ? 'matched' : 'did not match'}`);

    return isMatch;
  } catch (error) {
    console.error('Error during password verification:', error);
    return false;
  }
}
