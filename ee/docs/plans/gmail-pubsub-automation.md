# Gmail Pub/Sub Configuration Automation Plan

## Overview

Remove the manual Pub/Sub configuration section from the Gmail provider setup form and automate it in the background using standardized naming conventions.

## Problem Statement

Currently, users must manually configure Google Pub/Sub settings when setting up Gmail email providers. This creates complexity and potential for errors in the setup process.

## Solution

Automate the Pub/Sub configuration using standardized naming conventions based on tenant ID, removing the manual configuration UI entirely.

## Implementation Plan

### Phase 1: Simplify Gmail Provider Form

- [ ] Remove "Pub/Sub Configuration" card from `GmailProviderForm.tsx`
- [ ] Remove `pubsubTopicName` and `pubsubSubscriptionName` fields from form schema
- [ ] Remove manual "Setup Pub/Sub" button and related UI state
- [ ] Update form validation to remove Pub/Sub field requirements

### Phase 2: Implement Automatic Pub/Sub Setup

- [ ] Modify `upsertEmailProvider` function to automatically call `setupPubSub()` after saving provider config
- [ ] Implement standardized naming conventions:
  - Topic: `gmail-notifications-{tenant-id}`
  - Subscription: `gmail-webhook-{tenant-id}`
  - Webhook URL: `${process.env.NEXT_PUBLIC_APP_URL}/api/email/webhooks/google`
- [ ] Handle setup automatically during OAuth flow
- [ ] Add proper error handling for Pub/Sub setup failures

### Phase 3: Update Database Schema

- [ ] Set default values for `pubsub_topic_name` and `pubsub_subscription_name` in database
- [ ] Use tenant-specific naming for proper isolation
- [ ] Update existing records to use standardized naming

### Phase 4: Improve User Experience

- [ ] Add loading states during automatic setup
- [ ] Provide clear success/error feedback
- [ ] Surface meaningful error messages if setup fails
- [ ] Simplify setup flow: OAuth → automatic configuration → ready to use

## Technical Details

### Naming Conventions

```typescript
const topicName = `gmail-notifications-${tenantId}`;
const subscriptionName = `gmail-webhook-${tenantId}`;
const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/email/webhooks/google`;
```

### Files to Modify

1. `server/src/components/GmailProviderForm.tsx` - Remove Pub/Sub UI
2. `server/src/lib/actions/email-actions/emailProviderActions.ts` - Add automatic setup
3. Form schema validation - Remove Pub/Sub fields
4. Database defaults - Set standard naming patterns

## Benefits

- **Simplified UX**: Users only see OAuth setup, not infrastructure details
- **Reduced Errors**: No manual configuration means fewer mistakes
- **Consistent Naming**: Standardized topic/subscription names across tenants
- **Better Security**: Less exposure of technical implementation details
- **Faster Setup**: Fewer clicks and steps for users

## Backward Compatibility

- Keep existing `setupPubSub` function but call it automatically
- Preserve webhook URL structure and processing logic
- Ensure existing configured providers continue working
- Migration path for existing manual configurations

## Success Criteria

- Gmail provider setup requires only OAuth authentication
- Pub/Sub infrastructure is created automatically with standardized naming
- Existing email processing continues to work without interruption
- Setup process is faster and more reliable
- Error handling provides clear feedback to users