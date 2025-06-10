# Email Settings Access Guide

## Overview

The Email Settings component allows administrators to configure email providers, manage custom domains, and set up email delivery preferences for the tenant.

## Accessing Email Settings

The Email Settings interface is now available in the main Settings page:

1. Navigate to **Settings** from the bottom menu
2. Click on the **Email** tab

Alternatively, you can directly access it via:
- URL: `/msp/settings?tab=email`

## Features Available

### 1. Email Providers Configuration
- Configure SMTP settings (host, port, username, password)
- Set up Resend API integration
- Enable/disable providers
- Set provider priorities for failover

### 2. Custom Domains
- Add custom email domains
- View DNS configuration requirements
- Verify domain ownership
- Monitor domain verification status

### 3. General Settings
- Choose default email provider (SMTP, Resend, or Hybrid)
- Enable/disable provider fallback
- Enable/disable email tracking
- Set daily email limits

## Required Permissions

Users need appropriate permissions to access and modify email settings. The component uses server actions that automatically check user authentication and tenant context.

## Technical Implementation

The Email Settings component is located at:
- Component: `/server/src/components/admin/EmailSettings.tsx`
- Server Actions: `/server/src/lib/actions/email-actions/`
  - `emailSettingsActions.ts` - Main settings management
  - `emailDomainActions.ts` - Domain management
  - `emailActions.ts` - Email sending functionality

The component is integrated into the main Settings page (`/server/src/components/settings/general/SettingsPage.tsx`) as a new tab.

## Database Tables

The following tables store email configuration:
- `tenant_email_settings` - Tenant-wide email configuration
- `email_domains` - Custom domain management
- `email_sending_logs` - Email delivery tracking
- `email_provider_health` - Provider health monitoring
- `email_templates` - Customizable email templates

## Workflow Integration

Domain verification is handled through the workflow system. When a new domain is added, a verification workflow is automatically triggered to handle DNS verification and provider setup.