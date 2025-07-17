#!/usr/bin/env node

/**
 * Development server with ngrok instructions
 * Provides clear instructions for manual ngrok setup
 */

import { spawn } from 'child_process';

function startDevelopment() {
  console.log('🚀 Starting development server with ngrok webhook support...');
  console.log('');
  
  // Check if NGROK_URL is already set
  if (process.env.NGROK_URL) {
    console.log(`✅ ngrok URL detected: ${process.env.NGROK_URL}`);
    console.log('   Gmail webhooks will use this URL for local testing.');
    console.log('');
  } else {
    console.log('📡 To enable Gmail webhook testing with ngrok:');
    console.log('');
    console.log('1. In a separate terminal, run:');
    console.log('   ngrok http 3000');
    console.log('');
    console.log('2. Copy the https URL (e.g., https://abc123.ngrok.io)');
    console.log('');
    console.log('3. Restart this server with:');
    console.log('   NGROK_URL=https://abc123.ngrok.io npm run dev');
    console.log('');
    console.log('💡 Or use our helper scripts:');
    console.log('   npm run ngrok:tunnel  # Start ngrok in another terminal');
    console.log('');
    console.log('⚠️  Without ngrok, Gmail webhooks will use localhost (limited functionality)');
    console.log('');
  }
  
  console.log('🔧 Starting Next.js development server...');
  
  // Start Next.js development server
  const nextDev = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // NGROK_URL will be used by generatePubSubNames if set
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down development server...');
    nextDev.kill('SIGTERM');
    process.exit(0);
  });

  // Handle Next.js process exit
  nextDev.on('exit', (code) => {
    console.log(`Next.js process exited with code ${code}`);
    process.exit(code);
  });
}

// Start the development environment
startDevelopment();