# Outbound Email Abstraction Project Plan

## Overview

This project introduces a unified abstraction layer for sending outbound emails that supports multiple transport methods, starting with SMTP and Resend API integration. The abstraction will provide a consistent interface while allowing for different email providers based on configuration.

## Goals

1. **Unified Interface**: Create a single email service interface that can switch between transport methods
2. **Provider Support**: Initially support SMTP and Resend.com API
3. **Configuration-Driven**: Allow runtime switching between providers via configuration
4. **Backwards Compatibility**: Maintain existing email functionality while introducing the new abstraction
5. **Future Extensibility**: Design for easy addition of other email providers (SendGrid, Mailgun, etc.)

## Current System Analysis

### Existing Email Infrastructure

The Alga PSA application has a comprehensive email system with the following components:

#### 1. Email Services (Multiple Implementations)
- **Primary Service**: `server/src/services/emailService.ts` - Singleton pattern with SMTP via nodemailer
- **Notification Service**: `server/src/lib/notifications/emailService.ts` - Handlebars template compilation
- **Event-driven Email**: `server/src/lib/notifications/email.ts` - Comprehensive notification system

#### 2. Current Configuration Structure
```typescript
// Current environment variables
EMAIL_ENABLE=false          // Global email toggle
EMAIL_FROM=noreply@example.com
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USERNAME=noreply@example.com
EMAIL_PASSWORD=             // Managed via Docker secrets
```

#### 3. Existing Features
- **Template System**: Handlebars-based with system and tenant-specific templates
- **Notification Categories**: Hierarchical category/subtype system 
- **User Preferences**: Per-user, per-category notification settings
- **Rate Limiting**: Per-tenant rate limiting (60 emails/minute default)
- **Audit Logging**: Comprehensive notification logs with delivery status
- **Multi-tenant Support**: Row-level security with tenant isolation
- **Event Bus Integration**: Redis-based asynchronous email processing

#### 4. Database Schema
- `system_email_templates`: System-wide default templates
- `tenant_email_templates`: Tenant-specific customizations with RLS
- `notification_settings`: Global tenant settings
- `notification_categories`: Tenant notification groupings
- `notification_subtypes`: Specific notification types
- `user_notification_preferences`: User-level preferences
- `notification_logs`: Delivery tracking and audit

#### 5. Integration Points
- **Invoice System**: `server/src/lib/jobs/handlers/invoiceEmailHandler.ts`
- **Ticket Events**: `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
- **Authentication**: `server/src/lib/email/sendVerificationEmail.ts`
- **Event Bus**: Asynchronous processing via Redis streams

### Current Limitations
1. **Single Provider**: Only supports SMTP, no API-based providers
2. **Separate Services**: Multiple email service implementations with overlapping functionality
3. **Configuration Complexity**: Multiple environment variables without provider abstraction
4. **Limited Fallback**: No automatic failover between transport methods

## Multi-Tenancy Strategy

### Tiered Email Domain Approach

Based on enterprise SaaS best practices and PSA industry standards, we will implement a **tiered email domain model**:

#### **Tier 1: Platform Domain (Default)**
- **Target**: Small-medium businesses, new customers
- **Implementation**: All emails from `tenant-name@yourdomain.com` or `noreply@yourdomain.com`
- **Benefits**: Zero configuration, immediate functionality, managed reputation
- **Use Case**: 80% of customers who value simplicity over branding

#### **Tier 2: Custom Domain (Enterprise Feature)**
- **Target**: Enterprise customers, professional service firms
- **Implementation**: Emails from `support@customer-company.com`
- **Requirements**: Customer configures DNS (SPF, DKIM, DMARC)
- **Benefits**: Brand consistency, professional appearance, compliance

#### **Tier 3: Hybrid Approach**
- **Target**: Growing businesses, mixed requirements
- **Implementation**: Custom domain for client-facing emails, platform domain for internal notifications
- **Benefits**: Selective branding where it matters most

### Centralized Provider Management

The underlying infrastructure uses a **centralized provider model**:

1. **Single Account Management**: Platform administrator manages all email provider accounts (Resend, SMTP)
2. **Tenant Isolation**: Each tenant's emails isolated through metadata, headers, and domain verification
3. **Simplified Setup**: Most tenants need zero email provider configuration
4. **Enterprise Flexibility**: Custom domain support for customers who require it

### Email Flow Examples

#### **Tier 1: Platform Domain**
```
Tenant "ACME-Corp" → Provider Manager → Resend API
                                     ↓
Email from: noreply@acme-corp.yourdomain.com
Reply-to: support@acme-corp.yourdomain.com
                                     ↓
Client receives professional email with tenant branding
                                     ↓
Audit logs per tenant in existing system
```

#### **Tier 2: Custom Domain**
```
Tenant "ACME-Corp" → Provider Manager → Resend API (Verified Domain)
                                     ↓
Email from: support@acmecorp.com (Customer's Domain)
DKIM signed by: acmecorp.com
                                     ↓
Client receives email from customer's actual domain
                                     ↓
Audit logs per tenant + domain verification status
```

### Key Multi-Tenancy Considerations

1. **Tenant Isolation**: 
   - All email logs separated by `tenant` column (existing RLS)
   - Email templates isolated per tenant (existing system)
   - Rate limiting per tenant (existing system)
   - Provider-level metadata tagging for tracking

2. **From Address Management**:
   - **Tier 1**: Platform-managed subdomains (`tenant-name@yourdomain.com`)
   - **Tier 2**: Customer-owned domains (`support@customer.com`)
   - **Tier 3**: Mixed approach based on email type

3. **Domain Verification & Security**:
   - Platform domains: Pre-verified in Resend
   - Custom domains: Customer completes DNS verification process
   - SPF/DKIM/DMARC configuration handled per domain
   - Reputation isolation between domains

4. **Compliance & Tracking**:
   - Provider-level webhook handling for delivery status
   - Tenant-specific bounce/complaint handling
   - Domain-specific reputation monitoring
   - Audit trails maintained per tenant in existing `notification_logs`

## Technical Design

### Integration Strategy

The abstraction will be implemented as a **centralized provider layer** that:

1. **Minimal Disruption**: Existing email service interfaces remain unchanged
2. **Gradual Migration**: Services can be migrated one at a time
3. **Centralized Management**: Single provider accounts managed by platform admins
4. **Tenant Transparency**: Tenants unaware of underlying provider complexity

### Core Components

#### 1. Email Provider Interface
```typescript
interface IEmailProvider {
  sendEmail(emailData: EmailData): Promise<EmailResult>;
  validateConfig(): Promise<boolean>;
  getProviderName(): string;
  isHealthy(): Promise<boolean>;
}
```

#### 2. Email Data Models (Enhanced for Multi-Tenancy)
```typescript
interface EmailData {
  to: string | string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  // Multi-tenant metadata (required)
  tenantId: string;      // Always required for tenant isolation
  userId?: string;       // Optional user context
  templateName?: string; // For template tracking
  // Provider-level tracking
  tags?: string[];       // Provider-specific tags for categorization
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
  timestamp: Date;
  tenantId: string;      // Tenant context for audit logs
  metadata?: {
    resendId?: string;   // Resend-specific message ID
    smtpResponse?: string; // SMTP server response
    tags?: string[];     // Applied tags
    webhookId?: string;  // For webhook correlation
  };
}

interface EmailAttachment {
  filename: string;
  path?: string;        // For file path attachments
  content?: Buffer;     // For inline content
  contentType: string;
  cid?: string;         // For embedded images
}

// Tenant-specific configuration (managed by platform)
interface TenantEmailSettings {
  tenantId: string;
  emailTier: 'platform' | 'custom' | 'hybrid';  // Email domain tier
  
  // Platform Domain Settings (Tier 1)
  platformDomain?: string;     // acme-corp.yourdomain.com
  defaultFromAddress: string;  // noreply@acme-corp.yourdomain.com
  
  // Custom Domain Settings (Tier 2)
  customDomain?: string;       // acmecorp.com
  customFromAddress?: string;  // support@acmecorp.com
  domainVerified: boolean;     // DNS verification status
  dkimEnabled: boolean;        // DKIM signing status
  
  // Common Settings
  replyToAddress?: string;     // tenant-specific reply-to
  customHeaders?: Record<string, string>; // tenant-specific headers
  tags?: string[];            // tenant-specific tags for all emails
  
  // Email Type Routing (Tier 3 - Hybrid)
  emailTypeRouting?: {
    invoices: 'platform' | 'custom';      // Where to send invoices
    notifications: 'platform' | 'custom'; // Where to send notifications
    tickets: 'platform' | 'custom';       // Where to send ticket updates
  };
}
```

#### 3. Provider Implementations

##### SMTP Provider (Existing Compatibility)
```typescript
export class SMTPEmailProvider implements IEmailProvider {
  constructor(private config: SMTPConfig) {}
  
  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    // Leverage existing nodemailer logic from current services
    // Maintain compatibility with current SMTP configuration
  }
}
```

##### Resend Provider (Centralized Multi-Tenant)
```typescript
export class ResendEmailProvider implements IEmailProvider {
  private resend: Resend;
  private tenantSettingsCache: Map<string, TenantEmailSettings>;
  
  constructor(private config: ResendConfig) {
    this.resend = new Resend(config.apiKey);
    this.tenantSettingsCache = new Map();
  }
  
  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    // Get tenant-specific settings
    const tenantSettings = await this.getTenantSettings(emailData.tenantId);
    
    // Apply tenant-specific email configuration
    const resendData = {
      from: this.buildFromAddress(emailData.from, tenantSettings),
      to: emailData.to,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      headers: {
        ...emailData.headers,
        ...tenantSettings.customHeaders,
        'X-Tenant-ID': emailData.tenantId,  // For webhook correlation
        'X-User-ID': emailData.userId || '',
      },
      tags: [
        `tenant:${emailData.tenantId}`,
        ...(tenantSettings.tags || []),
        ...(emailData.tags || []),
      ],
    };
    
    const result = await this.resend.emails.send(resendData);
    
    return {
      success: true,
      messageId: result.id,
      provider: 'resend',
      timestamp: new Date(),
      tenantId: emailData.tenantId,
      metadata: {
        resendId: result.id,
        tags: resendData.tags,
      }
    };
  }
  
  private async getTenantSettings(tenantId: string): Promise<TenantEmailSettings> {
    // Cache tenant settings for performance
    if (this.tenantSettingsCache.has(tenantId)) {
      return this.tenantSettingsCache.get(tenantId)!;
    }
    
    // Load from database or configuration
    const settings = await this.loadTenantEmailSettings(tenantId);
    this.tenantSettingsCache.set(tenantId, settings);
    return settings;
  }
  
  private buildFromAddress(requestedFrom: string, settings: TenantEmailSettings): string {
    // Ensure all emails come from verified domains
    if (requestedFrom.includes(settings.fromDomain)) {
      return requestedFrom;
    }
    return settings.defaultFromAddress;
  }
}
```

#### 4. Centralized Provider Manager
```typescript
export class EmailProviderManager {
  private primaryProvider: IEmailProvider;
  private fallbackProvider?: IEmailProvider;
  private tenantService: TenantEmailSettingsService;
  
  constructor(config: EmailProviderConfig) {
    this.primaryProvider = this.createProvider(config.primary);
    if (config.fallback) {
      this.fallbackProvider = this.createProvider(config.fallback);
    }
    this.tenantService = new TenantEmailSettingsService();
  }
  
  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    // Validate tenant context
    if (!emailData.tenantId) {
      throw new Error('Tenant ID is required for all email operations');
    }
    
    // Apply tenant-specific rate limiting (using existing system)
    await this.checkTenantRateLimit(emailData.tenantId, emailData.userId);
    
    try {
      const result = await this.primaryProvider.sendEmail(emailData);
      
      // Log to tenant-specific audit trail
      await this.logEmailResult(result);
      
      return result;
    } catch (error) {
      if (this.fallbackProvider) {
        const result = await this.fallbackProvider.sendEmail(emailData);
        await this.logEmailResult(result);
        return result;
      }
      throw error;
    }
  }
  
  private async checkTenantRateLimit(tenantId: string, userId?: string): Promise<void> {
    // Leverage existing notification system rate limiting
    // This integrates with the current tenant-aware rate limiting
  }
  
  private async logEmailResult(result: EmailResult): Promise<void> {
    // Log to existing notification_logs table with tenant isolation
    // Maintains existing audit trail functionality
  }
}
```

## Resend Custom Domain Management

Based on the Context7 documentation, Resend handles custom domains through:

### **Domain Verification Architecture**
Resend uses a **subdomain-based approach** to avoid conflicts with existing email infrastructure:

```bash
# Customer adds these DNS records for domain verification:

# 1. DKIM Authentication (Required)
resend._domainkey.customer.com    TXT    "resend-generated-dkim-key"

# 2. SPF Authorization (Required)  
send.customer.com    TXT    "v=spf1 include:resend.net ~all"

# 3. MX Record for Bounce Handling (Required)
send.customer.com    MX    10 feedback-smtp.us-east-1.amazonses.com

# 4. DMARC Policy (Recommended)
_dmarc.customer.com    TXT    "v=DMARC1; p=none; rua=mailto:dmarcreports@customer.com;"
```

### **Multi-Tenant Domain Support**
- **Single Account**: One Resend account can manage **multiple domains** for different tenants
- **Domain Isolation**: Each verified domain has separate reputation and deliverability metrics
- **Regional Support**: Supports multiple AWS regions (us-east-1, eu-west-1, ap-northeast-1, sa-east-1)
- **Webhook Isolation**: Domain-specific webhook endpoints for bounce/complaint handling

### **Implementation for Multi-Tenancy**
```typescript
export class ResendEmailProvider implements IEmailProvider {
  private resend: Resend;
  private verifiedDomains: Set<string>;

  constructor(config: ResendConfig) {
    this.resend = new Resend(config.apiKey);
    this.verifiedDomains = new Set();
  }

  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    const tenantSettings = await this.getTenantSettings(emailData.tenantId);
    
    // Determine which domain to use
    const fromDomain = this.selectDomain(emailData, tenantSettings);
    
    // Validate domain is verified
    if (tenantSettings.emailTier === 'custom' && !tenantSettings.domainVerified) {
      throw new Error(`Custom domain ${tenantSettings.customDomain} not verified`);
    }

    const result = await this.resend.emails.send({
      from: this.buildFromAddress(emailData.from, fromDomain),
      to: emailData.to,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      headers: {
        ...emailData.headers,
        'X-Tenant-ID': emailData.tenantId,
      },
      tags: [
        `tenant:${emailData.tenantId}`,
        `domain:${fromDomain}`,
        ...(emailData.tags || [])
      ]
    });

    return {
      success: true,
      messageId: result.id,
      provider: 'resend',
      timestamp: new Date(),
      tenantId: emailData.tenantId,
      metadata: {
        resendId: result.id,
        domain: fromDomain,
        tags: result.tags
      }
    };
  }

  private selectDomain(emailData: EmailData, settings: TenantEmailSettings): string {
    switch (settings.emailTier) {
      case 'custom':
        return settings.customDomain!;
      case 'platform':
      default:
        return settings.platformDomain || 'yourdomain.com';
    }
  }
}
```

### **Fully Automated Domain Verification Workflow**

**Complete API Coverage**: Resend provides **full API automation** for domain creation, verification, and management.

#### **Automated Domain Management Service:**
```typescript
export class ResendDomainService {
  private resend: Resend;
  
  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }
  
  async createTenantDomain(tenantId: string, domain: string): Promise<DomainSetup> {
    try {
      // 1. Create domain in Resend via API
      const domainResult = await this.resend.domains.create({
        name: domain,
        region: 'us-east-1' // or tenant-specific region
      });
      
      // 2. Store domain info and DNS records in database
      await this.storeDomainSetup(tenantId, {
        resendDomainId: domainResult.id,
        domain: domainResult.name,
        status: domainResult.status,
        dnsRecords: domainResult.records,
        region: domainResult.region
      });
      
      // 3. Send DNS configuration instructions to tenant
      await this.sendDNSInstructions(tenantId, domainResult.records);
      
      return domainResult;
    } catch (error) {
      throw new Error(`Failed to create domain: ${error.message}`);
    }
  }
  
  async checkDomainVerification(tenantId: string): Promise<DomainStatus> {
    const domainSetup = await this.getTenantDomainSetup(tenantId);
    
    // Get current status from Resend API
    const domainInfo = await this.resend.domains.get(domainSetup.resendDomainId);
    
    // Update local database with current status
    await this.updateDomainStatus(tenantId, domainInfo.status);
    
    return {
      domain: domainInfo.name,
      status: domainInfo.status, // 'not_started' | 'pending' | 'verified' | 'failed'
      records: domainInfo.records,
      verifiedAt: domainInfo.status === 'verified' ? new Date() : null
    };
  }
  
  async triggerDomainVerification(tenantId: string): Promise<boolean> {
    const domainSetup = await this.getTenantDomainSetup(tenantId);
    
    try {
      // Trigger verification check via API
      await this.resend.domains.verify(domainSetup.resendDomainId);
      
      // Check updated status
      const status = await this.checkDomainVerification(tenantId);
      return status.status === 'verified';
    } catch (error) {
      console.error('Domain verification failed:', error);
      return false;
    }
  }
}
```

#### **Workflow-Managed Domain Verification Process:**

Using the existing workflow system to orchestrate the entire domain verification lifecycle:

```typescript
// System workflow for domain verification management
async function domainVerificationWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, logger, setState, data } = context;
  const { tenantId, domain } = context.input.triggerEvent.payload;
  
  setState('DOMAIN_CREATION_STARTED');
  logger.info(`Starting domain verification workflow for ${domain}`);
  
  try {
    // 1. Create domain in Resend via API
    const domainResult = await actions.createResendDomain({
      tenantId,
      domain,
      region: 'us-east-1'
    });
    
    data.set('domainSetup', domainResult);
    setState('DOMAIN_CREATED_DNS_PENDING');
    
    // 2. Send DNS instructions to tenant
    await actions.sendDNSInstructions({
      tenantId,
      domain,
      dnsRecords: domainResult.dnsRecords
    });
    
    // 3. Wait for tenant confirmation or timeout
    setState('AWAITING_DNS_CONFIGURATION');
    const dnsConfiguredEvent = await events.waitFor(
      'DNS_CONFIGURED',
      60 * 60 * 1000 // 1 hour timeout
    );
    
    if (!dnsConfiguredEvent) {
      // Create inline human task for follow-up if tenant doesn't respond
      const taskResult = await actions.createInlineTaskAndWaitForResult({
        title: `Follow up on DNS configuration for ${domain}`,
        description: `DNS configuration timeout. Please complete DNS setup for domain ${domain} or contact support if you need assistance.`,
        formDefinition: {
          jsonSchema: {
            type: 'object',
            title: 'DNS Configuration Follow-up',
            properties: {
              domainInfo: {
                type: 'string',
                title: 'Domain Information',
                readOnly: true,
                default: `Domain: ${domain}\nWaiting Time: 1 hour\nStatus: DNS configuration timeout`
              },
              dnsRecordsDisplay: {
                type: 'string',
                title: 'Required DNS Records',
                readOnly: true,
                default: `${JSON.stringify(domainResult.dnsRecords, null, 2)}`
              },
              userAction: {
                type: 'string',
                title: 'What would you like to do?',
                enum: ['continue_waiting', 'cancel_setup', 'contact_support'],
                enumNames: ['Continue waiting (DNS records are configured)', 'Cancel domain setup', 'Contact support for assistance']
              },
              notes: {
                type: 'string',
                title: 'Additional Notes (optional)',
                description: 'Any additional information about the DNS configuration'
              }
            },
            required: ['userAction']
          }
        },
        contextData: {
          tenantId,
          domain,
          dnsRecords: domainResult.dnsRecords,
          hoursWaiting: 1
        },
        waitForEventTimeoutMilliseconds: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      if (!taskResult.success || taskResult.resolutionData?.userAction === 'cancel_setup') {
        setState('DNS_CONFIGURATION_ABANDONED');
        return;
      }
    }
    
    // 4. Begin verification polling loop
    setState('VERIFYING_DOMAIN');
    let verificationAttempts = 0;
    const maxAttempts = 20; // 10 minutes total (30s intervals)
    
    while (verificationAttempts < maxAttempts) {
      verificationAttempts++;
      
      // Trigger verification check in Resend
      const verificationResult = await actions.triggerDomainVerification({
        tenantId,
        resendDomainId: domainResult.resendDomainId
      });
      
      if (verificationResult.status === 'verified') {
        setState('DOMAIN_VERIFIED');
        
        // 5. Activate domain for email sending
        await actions.activateCustomDomain({
          tenantId,
          domain,
          resendDomainId: domainResult.resendDomainId
        });
        
        // 6. Notify tenant of successful verification
        await actions.sendDomainVerificationSuccess({
          tenantId,
          domain
        });
        
        setState('DOMAIN_ACTIVE');
        logger.info(`Domain ${domain} successfully verified and activated`);
        return;
      }
      
      if (verificationResult.status === 'failed') {
        // Create human task for DNS troubleshooting
        const troubleshootResult = await actions.createInlineTaskAndWaitForResult({
          title: `DNS verification failed for ${domain}`,
          description: `Domain verification has failed. Please review your DNS settings and try again.`,
          formDefinition: {
            jsonSchema: {
              type: 'object',
              title: 'DNS Verification Failed',
              properties: {
                failureInfo: {
                  type: 'string',
                  title: 'Failure Information',
                  readOnly: true,
                  default: `Domain: ${domain}\nFailure Reason: ${verificationResult.failureReason}\nAttempt: ${verificationAttempts} of ${maxAttempts}`
                },
                dnsRecordsDisplay: {
                  type: 'string',
                  title: 'Required DNS Records',
                  readOnly: true,
                  default: `${JSON.stringify(domainResult.dnsRecords, null, 2)}`
                },
                nextAction: {
                  type: 'string',
                  title: 'What would you like to do?',
                  enum: ['retry_verification', 'cancel_setup', 'contact_support'],
                  enumNames: ['Retry verification (I\'ve fixed the DNS)', 'Cancel domain setup', 'Contact support for help']
                },
                troubleshootingNotes: {
                  type: 'string',
                  title: 'Troubleshooting Notes (optional)',
                  description: 'Any changes you made or issues you encountered'
                }
              },
              required: ['nextAction']
            }
          },
          contextData: {
            tenantId,
            domain,
            failureReason: verificationResult.failureReason,
            dnsRecords: domainResult.dnsRecords,
            currentAttempt: verificationAttempts
          },
          waitForEventTimeoutMilliseconds: 2 * 60 * 60 * 1000 // 2 hours
        });
        
        if (troubleshootResult.success && troubleshootResult.resolutionData?.nextAction === 'retry_verification') {
          // Reset attempt counter and continue
          verificationAttempts = 0;
          setState('RETRYING_VERIFICATION');
          continue;
        } else {
          setState('DOMAIN_VERIFICATION_FAILED');
          return;
        }
      }
      
      // Wait 30 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    // Max attempts reached - escalate to human task
    await actions.createInlineTaskAndWaitForResult({
      title: `Domain verification timeout for ${domain}`,
      description: `Domain verification has timed out after ${maxAttempts} attempts. Manual intervention may be required.`,
      formDefinition: {
        jsonSchema: {
          type: 'object',
          title: 'Domain Verification Timeout',
          properties: {
            timeoutInfo: {
              type: 'string',
              title: 'Timeout Information',
              readOnly: true,
              default: `Domain: ${domain}\nAttempts Completed: ${maxAttempts}\nTotal Time: ~${Math.round(maxAttempts * 30 / 60)} minutes`
            },
            dnsRecordsDisplay: {
              type: 'string',
              title: 'Required DNS Records',
              readOnly: true,
              default: `${JSON.stringify(domainResult.dnsRecords, null, 2)}`
            },
            resolution: {
              type: 'string',
              title: 'How would you like to proceed?',
              enum: ['manual_verification', 'cancel_setup', 'escalate_support'],
              enumNames: ['Manually verify domain (override)', 'Cancel domain setup', 'Escalate to technical support']
            },
            notes: {
              type: 'string',
              title: 'Additional Information',
              description: 'Any additional context about the timeout or domain setup'
            }
          },
          required: ['resolution']
        }
      },
      contextData: {
        tenantId,
        domain,
        attemptsCompleted: maxAttempts,
        dnsRecords: domainResult.dnsRecords
      }
    });
    
    setState('DOMAIN_VERIFICATION_TIMEOUT');
    
  } catch (error) {
    logger.error(`Domain verification workflow failed: ${error.message}`);
    setState('DOMAIN_VERIFICATION_ERROR');
    
    // Create error resolution task
    await actions.createInlineTaskAndWaitForResult({
      title: `Domain verification error for ${domain}`,
      description: `An unexpected error occurred during domain verification. Technical support may be required.`,
      formDefinition: {
        jsonSchema: {
          type: 'object',
          title: 'Domain Verification Error',
          properties: {
            errorInfo: {
              type: 'string',
              title: 'Error Information',
              readOnly: true,
              default: `Domain: ${domain}\nError: ${error.message}\nWorkflow Execution: ${context.executionId}`
            },
            errorDetails: {
              type: 'string',
              title: 'Technical Details',
              readOnly: true,
              default: JSON.stringify({
                tenantId,
                domain,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
              }, null, 2)
            },
            nextStep: {
              type: 'string',
              title: 'Next Steps',
              enum: ['retry_workflow', 'cancel_setup', 'escalate_technical'],
              enumNames: ['Retry domain verification workflow', 'Cancel domain setup', 'Escalate to technical team']
            },
            adminNotes: {
              type: 'string',
              title: 'Admin Notes',
              description: 'Any additional context or troubleshooting steps taken'
            }
          },
          required: ['nextStep']
        }
      },
      contextData: {
        tenantId,
        domain,
        error: error.message,
        workflowExecutionId: context.executionId
      }
    });
  }
}
```

#### **Workflow-Driven Benefits:**
1. **Automated Orchestration**: Complete automation of the domain verification process
2. **Human Task Integration**: Automatic escalation when manual intervention needed
3. **Timeout Management**: Built-in timeout handling with human task creation
4. **Retry Logic**: Intelligent retry mechanisms with human oversight
5. **Audit Trail**: Complete event-sourced history of domain verification process
6. **Error Recovery**: Graceful error handling with human task escalation
7. **Status Tracking**: Real-time workflow state updates visible in admin dashboard

### **Benefits for Multi-Tenant SaaS**
- **Reputation Isolation**: Each tenant's domain has independent reputation
- **Brand Consistency**: Tenants can send from their own domains
- **Compliance**: Meets enterprise requirements for branded communications
- **Scalability**: Single Resend account can manage hundreds of tenant domains
- **Cost Efficiency**: No need for separate Resend accounts per tenant

## Implementation Plan

### Phase 1: Foundation & Provider Abstraction (Week 1-2)
1. **Provider Interface**: Create `IEmailProvider` interface and base types
2. **SMTP Provider**: Extract existing SMTP logic into `SMTPEmailProvider`
3. **Provider Manager**: Implement `EmailProviderManager` with fallback support
4. **Configuration Schema**: Design unified configuration structure
5. **Testing Framework**: Set up unit tests for provider abstraction

**Deliverables:**
- `server/src/lib/email/providers/IEmailProvider.ts`
- `server/src/lib/email/providers/SMTPEmailProvider.ts`
- `server/src/lib/email/EmailProviderManager.ts`
- Unit tests for SMTP provider maintaining existing functionality

### Phase 2: Resend Integration (Week 2-3)
1. **Resend Provider**: Implement `ResendEmailProvider` with full API integration
2. **Environment Variables**: Add Resend configuration to environment schema
3. **Configuration Migration**: Update existing services to use provider manager
4. **Rate Limiting**: Implement Resend-specific rate limiting and quota management
5. **Testing**: Create integration tests with Resend test endpoints

**Deliverables:**
- `server/src/lib/email/providers/ResendEmailProvider.ts`
- Updated environment configuration
- Integration tests with Resend sandbox
- Documentation for Resend setup and domain verification

### Phase 3: Service Integration & Migration (Week 3-4)
1. **Service Refactoring**: Update existing email services to use provider manager
   - Migrate `server/src/services/emailService.ts`
   - Update `server/src/lib/notifications/emailService.ts`
   - Integrate with notification system in `server/src/lib/notifications/email.ts`
2. **Configuration Management**: Implement runtime provider switching
3. **Error Handling**: Add comprehensive error handling and retry logic
4. **Monitoring Integration**: Add provider-specific logging and metrics

**Deliverables:**
- Refactored email services using provider abstraction
- Configuration management for provider selection
- Enhanced error handling and retry mechanisms
- Provider health monitoring

### Phase 4: Testing, Documentation & Deployment (Week 4-5)
1. **End-to-End Testing**: Comprehensive testing of all email flows
2. **Performance Testing**: Compare provider performance and reliability
3. **Documentation**: Complete API documentation and deployment guides
4. **Migration Guide**: Create step-by-step migration instructions
5. **Monitoring Dashboard**: Implement email provider monitoring

**Deliverables:**
- Complete test suite covering all email scenarios
- Performance benchmarks and recommendations
- Updated deployment documentation
- Migration guide for existing installations
- Provider monitoring and alerting

## Configuration Structure

### Unified Configuration Schema
```typescript
interface EmailProviderConfig {
  enabled: boolean;
  primary: ProviderConfig;
  fallback?: ProviderConfig;
  defaults: {
    from: string;
    replyTo?: string;
  };
}

interface ProviderConfig {
  type: 'smtp' | 'resend';
  config: SMTPConfig | ResendConfig;
}

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface ResendConfig {
  apiKey: string;
  domain?: string;
  rateLimitPerMinute?: number;
}
```

### Environment Variables (Centralized Management)

```bash
# Global Email Configuration (Platform Admin Managed)
EMAIL_ENABLE=true                    # Existing: Global toggle
EMAIL_PROVIDER=resend               # New: Primary provider (smtp|resend)
EMAIL_FALLBACK_PROVIDER=smtp        # New: Fallback provider

# Existing SMTP Configuration (Maintained for Fallback)
EMAIL_HOST=smtp.gmail.com           # Existing: SMTP host
EMAIL_PORT=587                      # Existing: SMTP port  
EMAIL_USERNAME=your-email@gmail.com # Existing: SMTP username
EMAIL_PASSWORD=                     # Existing: SMTP password (Docker secret)
EMAIL_FROM=noreply@yourdomain.com   # Existing: Default from address

# Centralized Resend Configuration (Platform-Wide)
RESEND_API_KEY=re_xxxxxxxxx         # New: Single Resend account API key (Docker secret)
RESEND_VERIFIED_DOMAINS=yourdomain.com,tenant1.yourdomain.com  # Comma-separated verified domains
RESEND_DEFAULT_DOMAIN=yourdomain.com # Default domain for tenant subdomains
RESEND_WEBHOOK_SECRET=whsec_xxxxx   # Webhook signature verification secret

# Tenant Email Management
EMAIL_TENANT_SUBDOMAIN_PATTERN="{tenant}.yourdomain.com"  # Pattern for tenant subdomains
EMAIL_TENANT_FROM_PATTERN="noreply@{tenant}.yourdomain.com"  # Pattern for tenant from addresses

# Backward Compatibility (Legacy Variables)
SMTP_HOST=                          # Legacy: Alias for EMAIL_HOST
SMTP_PORT=                          # Legacy: Alias for EMAIL_PORT
SMTP_USER=                          # Legacy: Alias for EMAIL_USERNAME
SMTP_PASS=                          # Legacy: Alias for EMAIL_PASSWORD
SMTP_FROM=                          # Legacy: Alias for EMAIL_FROM
```

### Tenant Email Configuration (Database-Driven)

Instead of environment variables per tenant, tenant-specific settings are managed in the database:

```sql
-- New table for tenant email settings
CREATE TABLE tenant_email_settings (
  id SERIAL PRIMARY KEY,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  from_domain VARCHAR(255) NOT NULL,           -- tenant1.yourdomain.com
  default_from_address VARCHAR(255) NOT NULL,  -- noreply@tenant1.yourdomain.com
  reply_to_address VARCHAR(255),               -- support@tenant1.yourdomain.com
  custom_headers JSONB DEFAULT '{}',           -- Tenant-specific headers
  tags TEXT[] DEFAULT '{}',                    -- Default tags for tenant emails
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant)
);
```

### Docker Secrets Integration
```bash
# Existing Secrets (Maintained)
email_password                      # SMTP password
token_secret_key                    # Authentication
nextauth_secret                     # NextAuth

# New Secrets
resend_api_key                      # Resend API key
```

## Testing Strategy

### Unit Tests
- Provider interface compliance
- Email data validation
- Configuration validation
- Error handling scenarios

### Integration Tests
- SMTP provider with test email server
- Resend provider with sandbox/test addresses
- Factory pattern provider selection
- Fallback mechanism testing

### End-to-End Tests
- Complete email sending workflows
- Template rendering with different providers
- Attachment handling
- Error recovery scenarios

## Security Considerations

1. **API Key Management**: Secure storage of Resend API keys
2. **Email Validation**: Prevent email injection attacks
3. **Rate Limiting**: Implement sending rate limits
4. **Domain Verification**: Ensure proper domain setup for production
5. **Logging**: Avoid logging sensitive email content

## Monitoring & Observability

1. **Metrics**: Track sending success rates by provider
2. **Logging**: Log email sending attempts and results
3. **Alerting**: Alert on provider failures or high error rates
4. **Dashboard**: Monitor email queue and delivery statistics

## Migration Strategy

### Phase 1: Backward Compatible Integration
1. **Provider Layer Introduction**: Add provider abstraction without changing existing APIs
2. **Configuration Enhancement**: Extend environment variables while maintaining backward compatibility
3. **Gradual Service Migration**: Migrate services one at a time starting with least critical
4. **Monitoring**: Add comprehensive logging for both old and new implementations

### Phase 2: Feature Flag Rollout  
1. **Environment-Based Switching**: Use `EMAIL_PROVIDER` to control provider selection
2. **Tenant-Level Configuration**: Allow per-tenant provider configuration (future enhancement)
3. **A/B Testing**: Split traffic between providers for performance comparison
4. **Fallback Validation**: Thoroughly test automatic fallback mechanisms

### Phase 3: Service Consolidation
1. **API Unification**: Consolidate multiple email service implementations
2. **Legacy Cleanup**: Remove duplicate email service code
3. **Configuration Simplification**: Streamline environment variable usage
4. **Documentation Updates**: Update all references to new unified system

### Rollback Strategy
1. **Environment Variable Rollback**: Set `EMAIL_PROVIDER=smtp` to revert to SMTP
2. **Service-Level Rollback**: Capability to revert individual services to original implementation
3. **Configuration Isolation**: Keep old and new configurations separate during transition
4. **Monitoring Alerts**: Automated alerts for email delivery failures or provider issues

### Risk Mitigation
1. **Comprehensive Testing**: Test all email flows before production deployment
2. **Gradual Deployment**: Deploy to staging environments first, then production
3. **Monitoring**: Real-time monitoring of email delivery rates and provider health
4. **Emergency Procedures**: Documented procedures for quick provider switching in emergencies

## Future Enhancements

1. **Additional Providers**: SendGrid, Mailgun, Amazon SES
2. **Email Templates**: Enhanced template system with provider-specific optimizations
3. **Webhooks**: Implement delivery status tracking via provider webhooks
4. **Email Analytics**: Advanced email performance metrics
5. **Queue System**: Implement email queue for high-volume sending

## Success Criteria

- [ ] Both SMTP and Resend providers successfully send emails
- [ ] Zero downtime migration from existing email service
- [ ] Improved email deliverability with Resend
- [ ] Comprehensive test coverage (>90%)
- [ ] Complete documentation and deployment guides
- [ ] Monitoring and alerting in place