#!/usr/bin/env node

/**
 * Script to refresh Gmail watch subscriptions
 * Usage: node scripts/refresh-gmail-watch.js [email]
 */

import { getAdminConnection } from '../src/lib/db/admin.js';

async function refreshGmailWatch(email) {
  try {
    const knex = await getAdminConnection();
    
    // Find the Gmail provider
    const provider = await knex('email_providers')
      .where('provider_type', 'google')
      .where('is_active', true)
      .where(email ? knex.raw('LOWER(mailbox) = ?', [email.toLowerCase()]) : knex.raw('1=1'))
      .first();
    
    if (!provider) {
      console.error(`❌ Gmail provider not found${email ? ` for email: ${email}` : ''}`);
      process.exit(1);
    }
    
    console.log(`🔍 Found Gmail provider: ${provider.mailbox} (ID: ${provider.id})`);
    
    // Get the base URL for the API call
    const baseUrl = process.env.NGROK_URL || 
                   process.env.NEXT_PUBLIC_APP_URL || 
                   process.env.NEXTAUTH_URL ||
                   'http://localhost:3000';
    
    const refreshUrl = `${baseUrl}/api/email/refresh-watch`;
    
    console.log(`🔄 Calling refresh endpoint: ${refreshUrl}`);
    
    // Make the API call
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerId: provider.id
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Gmail watch subscription refreshed successfully');
      console.log(`📧 Mailbox: ${result.mailbox}`);
      console.log(`🆔 Provider ID: ${result.providerId}`);
    } else {
      console.error('❌ Failed to refresh Gmail watch subscription:', result.error);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Script error:', error.message);
    process.exit(1);
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (process.argv.length > 3) {
  console.log('Usage: node scripts/refresh-gmail-watch.js [email]');
  process.exit(1);
}

console.log('🧪 Starting Gmail watch refresh...');
if (email) {
  console.log(`📧 Target email: ${email}`);
} else {
  console.log('📧 Will refresh first active Gmail provider found');
}

refreshGmailWatch(email);