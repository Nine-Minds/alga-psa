# Email System Documentation

## Overview

The email system in this application is built on a base class architecture with two specialized services:

1. **BaseEmailService** - Abstract base class providing common email functionality
2. **SystemEmailService** - For platform-level emails using environment variables
3. **TenantEmailService** - For tenant-specific business emails using database settings

## Architecture

### BaseEmailService

The `BaseEmailService` is an abstract class that provides:
- Common email sending logic via nodemailer
- Template processing support
- Error handling and logging
- Email address normalization
- Configuration management

Both SystemEmailService and TenantEmailService extend this base class.

## When to Use Each Service

### SystemEmailService

Use SystemEmailService for emails that are:
- Platform/system level (not tenant-specific)
- Authentication related (registration, password reset)
- System notifications
- Admin alerts
- Any email that should use the platform's email configuration

**Examples:**
- Email verification for new user registration
- Password reset emails
- System maintenance notifications
- Admin alerts about system issues

### TenantEmailService  

Use TenantEmailService for emails that are:
- Sent on behalf of a specific tenant/company
- Business communications to clients
- Part of tenant-specific workflows
- Need to use tenant's custom email settings

**Examples:**
- Portal invitation emails
- Invoice emails to clients
- Project update notifications
- Ticket notifications
- Any client-facing business communication

## Code Examples

### System Email Example

```typescript
import { getSystemEmailService } from '@/lib/email';

// Send email verification
const systemEmailService = await getSystemEmailService();
await systemEmailService.sendEmailVerification({
  email: 'user@example.com',
  verificationUrl: 'https://app.com/verify?token=xyz',
  companyName: 'ACME Corp',
  expirationTime: '24 hours'
});

// Send password reset
await systemEmailService.sendPasswordReset({
  username: 'user@example.com',
  resetUrl: 'https://app.com/reset?token=xyz',
  expirationTime: '1 hour'
});

// Send custom system email
await systemEmailService.sendEmail({
  to: 'admin@example.com',
  subject: 'System Alert',
  html: '<p>System alert message</p>',
  text: 'System alert message'
});

// System email with template processor (e.g., portal invitation)
const templateProcessor = new DatabaseTemplateProcessor(knex, 'portal-invitation');
await systemEmailService.sendEmail({
  to: 'user@example.com',
  templateProcessor,
  templateData: {
    contactName: 'John Doe',
    portalLink: 'https://portal.com/invite/xyz'
  },
  replyTo: 'support@company.com'
});
```

### Tenant Email Example

```typescript
import { TenantEmailService, DatabaseTemplateProcessor } from '@/lib/email';
import { createTenantKnex, runWithTenant } from '@/lib/db';

// Send portal invitation (with database template)
await runWithTenant(tenantId, async () => {
  const { knex } = await createTenantKnex();
  
  const templateProcessor = new DatabaseTemplateProcessor(knex, 'portal-invitation');
  
  await TenantEmailService.sendEmail({
    tenantId,
    to: 'client@example.com',
    templateProcessor,
    templateData: {
      contactName: 'John Doe',
      companyName: 'Client Corp',
      portalLink: 'https://portal.com/invite/xyz'
    },
    fromName: 'ACME Support Team',
    replyTo: { email: 'support@acme.com' }
  });
});
```

## Directory Structure

```
/src/lib/email/
├── system/                      # System email service
│   ├── SystemEmailService.ts    # Main system email service
│   ├── types.ts                 # System email types
│   └── templates/               # System email templates
│       ├── emailVerification.ts
│       ├── passwordReset.ts
│       └── systemNotification.ts
├── tenant/                      # Tenant email service
│   ├── TenantEmailService.ts    # Main tenant email service
│   ├── templateProcessors.ts    # Template processing logic
│   └── types.ts                 # Tenant email types
├── index.ts                     # Main export file
└── README.md                    # This file
```

## Configuration

### System Email Configuration

System emails use environment variables:

```env
EMAIL_ENABLE=true                    # Enable/disable email sending
EMAIL_HOST=smtp.example.com          # SMTP host
EMAIL_PORT=587                       # SMTP port
EMAIL_USERNAME=noreply@example.com   # SMTP username
EMAIL_PASSWORD=secret                # SMTP password
EMAIL_FROM=noreply@example.com       # Default from address
```

### Tenant Email Configuration

Tenant emails use database configuration stored in:
- `tenant_email_settings` table - General email settings
- `email_templates` table - Email templates
- Provider-specific configuration in `provider_configs` field

## Template Processing

### System Email Templates

System emails use hardcoded templates within the SystemEmailService. Templates are simple functions that return HTML and text content.

### Tenant Email Templates  

Tenant emails support multiple template processors:

1. **DatabaseTemplateProcessor** - Loads templates from database
2. **StaticTemplateProcessor** - Uses provided template strings
3. **CustomTemplateProcessor** - Custom template processing logic

Example with custom processor:

```typescript
import { StaticTemplateProcessor } from '@/lib/email';

const processor = new StaticTemplateProcessor({
  subject: 'Welcome {{contactName}}!',
  htmlContent: '<h1>Welcome {{contactName}} to {{companyName}}</h1>',
  textContent: 'Welcome {{contactName}} to {{companyName}}'
});

await TenantEmailService.sendEmail({
  tenantId,
  to: 'user@example.com',
  templateProcessor: processor,
  templateData: {
    contactName: 'John',
    companyName: 'ACME'
  }
});
```

## Migration Guide

If you're updating existing code:

### Old Pattern (to avoid):
```typescript
// DON'T: Using TenantEmailService for system emails
import { TenantEmailService } from '../services/TenantEmailService';

await TenantEmailService.sendEmail({
  tenantId: 'system',
  to: email,
  templateName: 'email-verification',
  // ...
});
```

### New Pattern (recommended):
```typescript
// DO: Use appropriate service for email type
import { getSystemEmailService } from '@/lib/email';

const systemEmail = await getSystemEmailService();
await systemEmail.sendEmailVerification({
  email,
  verificationUrl,
  // ...
});
```

## Decision Tree

When implementing a new email feature, ask yourself:

1. **Is this email specific to a tenant/company?**
   - Yes → Use TenantEmailService
   - No → Continue to #2

2. **Is this email for authentication/system purposes?**
   - Yes → Use SystemEmailService
   - No → Continue to #3

3. **Does this email need tenant-specific configuration?**
   - Yes → Use TenantEmailService
   - No → Use SystemEmailService

## Best Practices

1. **Always use the appropriate service** - Don't use TenantEmailService for system emails or vice versa

2. **Handle errors gracefully** - Both services return result objects with success/error information

3. **Use template processors** - For tenant emails, always use a template processor for consistency

4. **Include proper context** - System emails should include minimal branding, tenant emails should include full tenant branding

5. **Test email configuration** - Both services have `isConfigured()` methods to check if email is properly configured

## Troubleshooting

### System Emails Not Sending

1. Check environment variables are set correctly
2. Verify SMTP credentials are valid
3. Check `EMAIL_ENABLE=true`
4. Look for errors in logs prefixed with `[SystemEmailService]`

### Tenant Emails Not Sending  

1. Check tenant has email settings configured in database
2. Verify tenant has an enabled email provider
3. Check provider-specific configuration is valid
4. Look for errors in logs prefixed with `[TenantEmailService]`

### Common Issues

- **Email verification using wrong service**: Email verification should use SystemEmailService, not TenantEmailService
- **Missing template**: Ensure database templates exist for tenant emails
- **Invalid provider config**: Check provider configuration in tenant_email_settings table