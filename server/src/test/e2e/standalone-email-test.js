#!/usr/bin/env node

import nodemailer from 'nodemailer';

async function testEmailSending() {
  console.log('🧪 Testing standalone email sending to MailHog...');
  
  // Configure transporter with fixed settings
  const transporter = nodemailer.createTransport({
    host: 'localhost',
    port: 1025,
    secure: false, // MailHog doesn't use TLS
    ignoreTLS: true, // Don't attempt STARTTLS
    requireTLS: false, // Don't require TLS
    // Don't set auth at all for MailHog
  });

  try {
    // Send test email
    const result = await transporter.sendMail({
      from: 'test@example.com',
      to: 'support@company.com',
      subject: 'Standalone Email Test',
      text: 'This is a standalone test email.',
      html: '<p>This is a standalone test email.</p>',
      headers: {
        'Message-ID': '<standalone-test-' + Date.now() + '@e2e-tests.local>',
        'X-Test-ID': 'standalone-' + Date.now()
      }
    });
    
    console.log('✅ Email sent successfully:', result.messageId);
    
    // Wait longer for MailHog to process the message
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const response = await fetch('http://localhost:8025/api/v1/messages');
    const data = await response.json();
    
    const messages = Array.isArray(data) ? data : (data.messages || []);
    console.log('📧 MailHog messages count:', messages.length);
    if (messages.length > 0) {
      console.log('📋 Latest message:', {
        subject: messages[0].Content.Headers.Subject?.[0],
        from: messages[0].Content.Headers.From?.[0],
        to: messages[0].Content.Headers.To?.[0]
      });
      console.log('✅ SUCCESS: Email successfully captured by MailHog!');
    } else {
      console.log('❌ FAILURE: Email not found in MailHog');
    }
    
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
  }
}

testEmailSending();