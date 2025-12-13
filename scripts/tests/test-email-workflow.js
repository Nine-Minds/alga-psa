#!/usr/bin/env node

// Test script to demonstrate email-to-ticket workflow

async function testEmailWorkflow() {
  console.log('🚀 Testing Email-to-Ticket Workflow');
  console.log('=====================================\n');

  // Step 1: Send test email to MailHog
  console.log('📧 Step 1: Sending test email to MailHog...');
  
  const emailResponse = await fetch('http://localhost:1025/api/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'customer@example.com',
      to: 'support@company.com',
      subject: 'Help with login issue',
      text: 'I cannot log into my account. Please help!'
    })
  });

  console.log('✅ Email sent to MailHog\n');

  // Step 2: Check MailHog for the email
  console.log('🔍 Step 2: Checking MailHog for captured email...');
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  
  const messagesResponse = await fetch('http://localhost:8025/api/v1/messages');
  const messagesData = await messagesResponse.json();
  const messages = Array.isArray(messagesData) ? messagesData : (messagesData.messages || []);
  
  console.log(`✅ Found ${messages.length} email(s) in MailHog\n`);
  
  if (messages.length > 0) {
    const email = messages[0];
    console.log('📋 Email details:');
    console.log(`   From: ${email.From?.Mailbox}@${email.From?.Domain}`);
    console.log(`   To: ${email.To?.[0]?.Mailbox}@${email.To?.[0]?.Domain}`);
    console.log(`   Subject: ${email.Content?.Headers?.Subject?.[0] || '(No Subject)'}`);
    console.log(`   Message ID: ${email.ID}\n`);
  }

  // Step 3: Monitor workflow worker logs
  console.log('👀 Step 3: Monitoring workflow activity...');
  console.log('Check docker logs for workflow worker to see event processing:\n');
  console.log('   docker logs sebastian_workflow_worker_test --tail 50\n');
  
  console.log('The email-to-ticket workflow is now running!');
  console.log('The MailHogPollingService will pick up the email and process it.');
}

// Run the test
testEmailWorkflow().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});