import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';
import fs from 'fs';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate secure random values
const generateSecureKey = () => randomBytes(32).toString('hex');
const generateBase64Key = () => randomBytes(32).toString('base64');

const requiredSecureKeys = {
  ALGA_AUTH_KEY: generateSecureKey,
  SECRET_KEY: generateSecureKey,
  NEXTAUTH_SECRET: generateBase64Key
};

// Load and preprocess environment variables
const envPath = join(__dirname, '../../.env');
console.log('Loading .env file from:', envPath);

// Create .env file if it doesn't exist
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, '');
}

// Read the .env file
let envContent = fs.readFileSync(envPath, 'utf8');

// Check for missing required secure keys and generate them
let hasNewKeys = false;
Object.entries(requiredSecureKeys).forEach(([key, generator]) => {
  // Skip if the key exists as an environment variable
  if (process.env[key]) {
    console.log(`Using existing environment variable for ${key}`);
    return;
  }

  // Check if key exists in .env file
  if (!envContent.includes(`${key}=`)) {
    const value = generator();
    const newLine = `${key}=${value}\n`;
    envContent = envContent + newLine;
    hasNewKeys = true;
    console.log(`Generated missing ${key}`);
  }
});

// Save any new keys that were generated
if (hasNewKeys) {
  fs.writeFileSync(envPath, envContent);
}

// Process each line to handle type conversion
const processedContent = envContent
  .split('\n')
  .map(line => {
    // Skip comments and empty lines
    if (line.trim().startsWith(';') || !line.includes('=')) return line;

    const [key, ...valueParts] = line.split('=');
    const rawValue = valueParts.join('=').trim();

    // Skip if no value
    if (!rawValue) return line;

    // Remove comments
    const value = rawValue.split(/[;#]/)[0].trim();

    // Convert boolean values
    if (key.includes('_ENABLE') || key.includes('_JSON') || key.includes('_DETAILS') || key.includes('_LOGGING')) {
      return `${key}=${value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes'}`;
    }

    // Convert number values
    if (key.includes('_PORT') || key.includes('_SIZE') || key.includes('_DAYS') || key.includes('_BYTES') || 
        key.includes('_LENGTH') || key.includes('ITERATIONS') || key.includes('_EXPIRES')) {
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        return `${key}=${num}`;
      }
    }

    return `${key}=${value}`;
  })
  .join('\n');

// Write processed content to a temporary file
const tempEnvPath = join(__dirname, '../../.env.processed');
fs.writeFileSync(tempEnvPath, processedContent);

// Load the processed environment variables
const result = config({ path: tempEnvPath });

// Clean up temporary file
fs.unlinkSync(tempEnvPath);

if (result.error) {
  console.error('Error loading .env file:', result.error);
  process.exit(1);
}

// This script runs before Next.js starts and validates environment variables
try {
  await import('../config/envConfig.js');
} catch (error) {
  // Only print the error message, not the stack trace
  if (error.message) {
    console.error(error.message);
  }
  process.exit(1);
}
