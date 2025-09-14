// Conditional export based on environment
// This will be the main entry point that determines OSS vs EE

const isEE = process.env.NODE_ENV === 'enterprise' || process.env.EDITION === 'enterprise';

if (isEE) {
  // Export EE implementation
  export * from './ee/entry.js';
} else {
  // Export OSS stub implementation
  export * from './oss/entry.js';
}
