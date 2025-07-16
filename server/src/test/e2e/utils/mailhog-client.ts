import nodemailer from 'nodemailer';
import axios from 'axios';

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
  inReplyTo?: string;
  references?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SentEmailResult {
  messageId: string;
  testId: string;
}

export interface MailHogMessage {
  ID: string;
  From: {
    Relays: any[];
    Mailbox: string;
    Domain: string;
    Params: string;
  };
  To: Array<{
    Relays: any[];
    Mailbox: string;
    Domain: string;
    Params: string;
  }>;
  Content: {
    Headers: Record<string, string[]>;
    Body: string;
    Size: number;
    MIME: any;
  };
  Created: string;
  MIME: any;
  Raw: {
    From: string;
    To: string[];
    Data: string;
    Helo: string;
  };
}

export class MailHogClient {
  private readonly config = {
    smtpPort: 1025,
    webPort: 8025,
    baseUrl: 'http://localhost:8025'
  };

  private transporter: nodemailer.Transporter;
  private lastTestId: string | null = null;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: this.config.smtpPort,
      secure: false, // MailHog doesn't use TLS
      ignoreTLS: true, // Don't attempt STARTTLS
      requireTLS: false, // Don't require TLS
      // Don't set auth at all for MailHog
    });
  }

  async sendEmail(emailData: EmailMessage): Promise<SentEmailResult> {
    console.log(`📧 Sending test email: ${emailData.subject}`);
    
    const testId = Date.now().toString();
    
    const mailOptions: nodemailer.SendMailOptions = {
      from: emailData.from,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.body,
      html: `<p>${emailData.body}</p>`,
      headers: {
        'Message-ID': `<test-${testId}@e2e-tests.local>`,
        'X-Test-ID': testId
      }
    };

    // Add reply headers if this is a reply
    if (emailData.inReplyTo) {
      mailOptions.headers!['In-Reply-To'] = emailData.inReplyTo;
    }
    
    if (emailData.references) {
      mailOptions.headers!['References'] = emailData.references;
    }

    // Add attachments if provided
    if (emailData.attachments && emailData.attachments.length > 0) {
      mailOptions.attachments = emailData.attachments.map(attachment => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType
      }));
    }

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully: ${result.messageId}`);
      
      this.lastTestId = testId;
      
      return {
        messageId: result.messageId || mailOptions.headers!['Message-ID'] as string,
        testId
      };
    } catch (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async waitForEmailCapture(messageId: string, timeoutMs: number = 30000): Promise<MailHogMessage> {
    console.log(`⏳ Waiting for email capture: ${messageId}`);
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getMessages();
        
        // Look for our test email by test ID or message content
        const capturedEmail = messages.find(msg => {
          const headers = msg.Content.Headers;
          const testId = headers['X-Test-ID']?.[0];
          const subject = headers.Subject?.[0];
          
          return testId === this.lastTestId || 
                 msg.Content.Body.includes('e2e-tests') ||
                 subject?.includes('Test');
        });

        if (capturedEmail) {
          console.log(`✅ Email captured: ${capturedEmail.Content.Headers.Subject?.[0]}`);
          return capturedEmail;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(`⏳ Waiting for MailHog response: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    throw new Error(`Email not captured within ${timeoutMs}ms: ${messageId}`);
  }

  async getMessages(): Promise<MailHogMessage[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/v1/messages`);
      return response.data || [];
    } catch (error) {
      throw new Error(`Failed to get MailHog messages: ${error.message}`);
    }
  }

  async getMessageById(id: string): Promise<MailHogMessage | null> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/v1/messages/${id}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to get message ${id}: ${error.message}`);
    }
  }

  async clearMessages(): Promise<void> {
    try {
      await axios.delete(`${this.config.baseUrl}/api/v1/messages`);
      console.log('🧹 MailHog messages cleared');
    } catch (error) {
      throw new Error(`Failed to clear MailHog messages: ${error.message}`);
    }
  }

  async deleteMessage(id: string): Promise<void> {
    try {
      await axios.delete(`${this.config.baseUrl}/api/v1/messages/${id}`);
      console.log(`🗑️ Message ${id} deleted`);
    } catch (error) {
      throw new Error(`Failed to delete message ${id}: ${error.message}`);
    }
  }

  async getMessageCount(): Promise<number> {
    const messages = await this.getMessages();
    return messages.length;
  }

  async waitForMessageCount(expectedCount: number, timeoutMs: number = 30000): Promise<void> {
    console.log(`⏳ Waiting for ${expectedCount} messages in MailHog...`);
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const currentCount = await this.getMessageCount();
      
      if (currentCount >= expectedCount) {
        console.log(`✅ Expected message count reached: ${currentCount}`);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const finalCount = await this.getMessageCount();
    throw new Error(`Expected ${expectedCount} messages, but got ${finalCount} within ${timeoutMs}ms`);
  }

  async searchMessages(criteria: {
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
  }): Promise<MailHogMessage[]> {
    const allMessages = await this.getMessages();
    
    return allMessages.filter(message => {
      const headers = message.Content.Headers;
      
      if (criteria.from && !headers.From?.[0]?.includes(criteria.from)) {
        return false;
      }
      
      if (criteria.to && !headers.To?.[0]?.includes(criteria.to)) {
        return false;
      }
      
      if (criteria.subject && !headers.Subject?.[0]?.includes(criteria.subject)) {
        return false;
      }
      
      if (criteria.body && !message.Content.Body.includes(criteria.body)) {
        return false;
      }
      
      return true;
    });
  }

  async getEmailThread(messageId: string): Promise<MailHogMessage[]> {
    const allMessages = await this.getMessages();
    const thread: MailHogMessage[] = [];
    
    // Find the initial message
    const initialMessage = allMessages.find(msg => 
      msg.Content.Headers['Message-ID']?.[0] === messageId
    );
    
    if (!initialMessage) {
      return thread;
    }
    
    thread.push(initialMessage);
    
    // Find replies (messages with In-Reply-To or References matching this message)
    const replies = allMessages.filter(msg => {
      const inReplyTo = msg.Content.Headers['In-Reply-To']?.[0];
      const references = msg.Content.Headers['References']?.[0];
      
      return inReplyTo === messageId || references?.includes(messageId);
    });
    
    thread.push(...replies);
    
    // Sort by creation date
    thread.sort((a, b) => new Date(a.Created).getTime() - new Date(b.Created).getTime());
    
    return thread;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await axios.get(this.config.baseUrl, { timeout: 5000 });
      return response.status === 200 && response.data.includes('MailHog');
    } catch (error) {
      return false;
    }
  }
}