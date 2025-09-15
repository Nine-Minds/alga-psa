#!/usr/bin/env node

/**
 * Startup script that allows switching between Express and Next.js servers
 * via environment variable for easy rollback
 */

const useExpress = process.env.USE_EXPRESS_SERVER === 'true';

if (useExpress) {
  console.log('Starting with Express server wrapper...');
  // Use tsx to run TypeScript directly
  require('child_process').spawn('tsx', ['index.ts'], {
    stdio: 'inherit',
    env: process.env
  });
} else {
  console.log('Starting with Next.js directly...');
  // Use Next.js CLI
  require('child_process').spawn('npx', ['next', 'start'], {
    stdio: 'inherit',
    env: process.env
  });
}