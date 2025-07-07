/**
 * Email Processor - Handles email sending and validation for E2E tests
 */

import nodemailer from 'nodemailer';
import axios from 'axios';

export class EmailProcessor {
  constructor() {
    this.mailhogConfig = {
      smtpPort: 1025,
      webPort: 8025,
      baseUrl: 'http://localhost:8025'
    };
    
    this.transporter = nodemailer.createTransporter({
      host: 'localhost',
      port: this.mailhogConfig.smtpPort,
      secure: false, // MailHog doesn't use TLS
      auth: false // MailHog doesn't require auth
    });

    this.lastEmailId = null;
  }

  async sendTestEmail(emailData) {
    console.log(`📧 Sending test email: ${emailData.subject}`);
    
    const mailOptions = {
      from: emailData.from,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.body,
      html: `<p>${emailData.body}</p>`,
      headers: {
        'Message-ID': `<test-${Date.now()}@e2e-tests.local>`,
        'X-Test-ID': Date.now().toString()
      }
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully: ${result.messageId}`);
      
      // Store the test ID for later verification
      this.lastTestId = mailOptions.headers['X-Test-ID'];
      
      return result;
    } catch (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async verifyEmailCaptured() {
    console.log('🔍 Verifying email was captured by MailHog...');
    
    // Wait a moment for email to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await axios.get(`${this.mailhogConfig.baseUrl}/api/v1/messages`);
      const messages = response.data;
      
      if (!messages || messages.length === 0) {
        throw new Error('No messages found in MailHog');
      }

      // Find our test email by test ID
      const testEmail = messages.find(msg => 
        msg.Content && 
        msg.Content.Headers && 
        msg.Content.Headers['X-Test-ID'] && 
        msg.Content.Headers['X-Test-ID'][0] === this.lastTestId
      );

      if (!testEmail) {
        throw new Error(`Test email with ID ${this.lastTestId} not found in MailHog`);
      }

      console.log(`✅ Email captured by MailHog: ${testEmail.Content.Headers.Subject[0]}`);
      this.lastEmailId = testEmail.ID;
      
      return testEmail;
    } catch (error) {
      throw new Error(`Failed to verify email capture: ${error.message}`);
    }
  }

  async sendReplyEmail(originalEmail, replyData) {
    console.log(`📧 Sending reply email: ${replyData.subject}`);
    
    const originalHeaders = originalEmail.Content.Headers;
    const originalMessageId = originalHeaders['Message-ID'][0];
    
    const mailOptions = {
      from: replyData.from,
      to: replyData.to,
      subject: replyData.subject,
      text: replyData.body,
      html: `<p>${replyData.body}</p>`,
      headers: {
        'Message-ID': `<reply-${Date.now()}@e2e-tests.local>`,
        'In-Reply-To': originalMessageId,
        'References': originalMessageId,
        'X-Test-ID': Date.now().toString()
      }
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Reply email sent successfully: ${result.messageId}`);
      
      this.lastTestId = mailOptions.headers['X-Test-ID'];
      return result;
    } catch (error) {
      throw new Error(`Failed to send reply email: ${error.message}`);
    }
  }

  async getMailHogMessages() {
    try {
      const response = await axios.get(`${this.mailhogConfig.baseUrl}/api/v1/messages`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get MailHog messages: ${error.message}`);
    }
  }

  async clearMailHogMessages() {
    try {
      await axios.delete(`${this.mailhogConfig.baseUrl}/api/v1/messages`);
      console.log('🧹 MailHog messages cleared');
    } catch (error) {
      throw new Error(`Failed to clear MailHog messages: ${error.message}`);
    }
  }
}