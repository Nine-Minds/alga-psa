# Customer Portal Onboarding Flow Implementation Plan

## Component Location Map

### Existing Components to Modify
- **ContactPortalTab**: `/src/components/contacts/ContactPortalTab.tsx`
- **Rate Limiting**: `/src/lib/security/rateLimiting.ts`
- **Email Templates**: `/src/components/settings/notifications/EmailTemplates.tsx`
- **Notification System**: `/src/lib/models/notification.ts`
- **Contact Actions**: `/src/lib/actions/contact-actions/contactActions.tsx`
- **Registration Actions**: `/src/lib/actions/user-actions/registrationActions.ts`

### New Components to Create
- **Portal Invitation Service**: `/src/lib/services/PortalInvitationService.ts`
- **Portal Setup Page**: `/src/app/auth/portal/setup/page.tsx`
- **Portal Invitation Actions**: `/src/lib/actions/portal-actions/portalInvitationActions.ts`
- **Database Migration**: `/migrations/[timestamp]_create_portal_invitations.cjs`

### Architecture Note
**Important**: This system uses Server Actions as the primary implementation method. APIs are reserved strictly for external user automation. All functionality should be implemented as server actions first, with API endpoints created only if external access is needed.

## Intro / Rationale

This plan implements a customer portal onboarding system that allows contacts marked as portal admins to be invited to access the client portal. The system provides secure token-based invitations with email integration and proper rate limiting.

### Success Criteria
- Portal admin contacts can receive invitation emails through ContactPortalTab
- Secure one-time tokens with 24-hour expiration are generated and managed
- Email notifications use existing template system with Portal Access category
- Rate limiting prevents invitation abuse
- Token verification enables password setup flow
- Automatic cleanup of expired tokens maintains database hygiene

### Key Requirements
- Database table for tracking invitations with UTC timestamps
- Integration with existing notification template system
- Rate limiting using existing infrastructure
- Frontend updates for invitation sending and portal setup
- Secure token generation and verification flow

## Phased Implementation Checklist

### Phase 1: Database Schema Setup
- [ ] Create `portal_invitations` table migration
  - [ ] Add fields: token, contact_id, tenant, expires_at, created_at, used_at, email
  - [ ] Add foreign key constraints to contacts table (keep it CitusDB compatible)
  - [ ] Add indexes for token lookup and tenant filtering (keep it CitusDB compatible)
  - [ ] Add automatic cleanup function for expired tokens
- [ ] Test migration rollback functionality
- [ ] Verify foreign key constraints work correctly

### Phase 2: Email Template System Integration
- [ ] Create "Portal Access" notification category
  - [ ] Add category to notification_categories table
  - [ ] Create portal-invitation notification subtype
- [ ] Create portal invitation email template
  - [ ] Add template to system_email_templates with {{portalLink}} placeholder
  - [ ] Include company branding and professional styling
  - [ ] Add both HTML and text versions
- [ ] Verify template rendering with test data

### Phase 3: Rate Limiting Integration
- [ ] Add portalInvitationLimiter to `/src/lib/security/rateLimiting.ts`
  - [ ] Configure 3 invitations per hour per contact
  - [ ] Add checkPortalInvitationLimit function
  - [ ] Include proper error formatting
- [ ] Test rate limiting behavior with multiple requests
- [ ] Verify rate limit reset functionality

### Phase 4: Token Management System
- [ ] Create secure token generation utility
  - [ ] Generate cryptographically secure tokens
  - [ ] Set 24-hour expiration
  - [ ] Store in portal_invitations table
- [ ] Create token verification system
  - [ ] Validate token exists and not expired
  - [ ] Mark token as used after successful verification
  - [ ] Trigger automatic cleanup of expired tokens
- [ ] Implement token cleanup job
  - [ ] Clean expired tokens when any token is verified
  - [ ] Log cleanup operations for monitoring

### Phase 5: Server Actions Development
- [ ] Create portal invitation server actions in `/src/lib/actions/portal-actions/portalInvitationActions.ts`
  - [ ] `sendPortalInvitation(contactId: string)` action
    - [ ] Validate contact is portal admin
    - [ ] Check rate limits before processing
    - [ ] Generate secure token
    - [ ] Send email via notification system
    - [ ] Return success/error response
  - [ ] `verifyPortalToken(token: string)` action
    - [ ] Validate token and expiration
    - [ ] Return contact information for setup
    - [ ] Handle token not found/expired cases
  - [ ] `completePortalSetup(token: string, password: string)` action
    - [ ] Verify token is valid and unused
    - [ ] Create user account with password
    - [ ] Mark token as used
    - [ ] Trigger token cleanup
  - [ ] `getPortalInvitations(contactId: string)` action
    - [ ] Retrieve invitation history for contact
  - [ ] `revokePortalInvitation(invitationId: string)` action
    - [ ] Mark invitation as revoked

### Phase 6: Frontend ContactPortalTab Updates
- [ ] Replace placeholder toast in handleSendInvitation
  - [ ] Call `sendPortalInvitation` server action
  - [ ] Show loading state during invitation sending
  - [ ] Display success/error messages appropriately
  - [ ] Handle rate limit errors with user-friendly messages
- [ ] Update invitation button state management
  - [ ] Disable during server action calls
  - [ ] Show appropriate messaging for different states
- [ ] Add invitation history section
  - [ ] Use `getPortalInvitations` server action to fetch history
  - [ ] Display table with sent date, status, expiry
  - [ ] Add revoke button calling `revokePortalInvitation` action
- [ ] Add invitation status indicators
  - [ ] Show if invitation has been sent
  - [ ] Display invitation expiration information

### Phase 7: Portal Setup Page Development
- [ ] Create portal setup page component at `/src/app/auth/portal/setup/page.tsx`
  - [ ] Call `verifyPortalToken` server action on page load
  - [ ] Password setup form with validation
  - [ ] Company and contact information display
  - [ ] Error handling for invalid/expired tokens
- [ ] Implement password setup form
  - [ ] Strong password requirements
  - [ ] Password confirmation validation
  - [ ] Form submission calls `completePortalSetup` server action
  - [ ] Redirect to portal login on success
- [ ] Add routing for setup page
  - [ ] Create route: `/auth/portal/setup?token=[token]`
  - [ ] Add proper error page for invalid tokens

### Phase 8: Integration Testing and Cleanup
- [ ] Test complete invitation flow end-to-end
  - [ ] Send invitation from ContactPortalTab
  - [ ] Receive email with portal link
  - [ ] Complete password setup process
  - [ ] Verify user can login to portal
- [ ] Test security scenarios
  - [ ] Rate limiting prevents abuse
  - [ ] Expired tokens are rejected
  - [ ] Used tokens cannot be reused
  - [ ] Invalid tokens show appropriate errors
- [ ] Verify token cleanup functionality
  - [ ] Expired tokens are automatically cleaned
  - [ ] Cleanup happens during token verification
  - [ ] Database remains clean over time

## Background Details / Implementation Advice

### Server Actions Pattern
All functionality should be implemented using Next.js Server Actions ('use server' directive). This provides:
- Direct database access without API overhead
- Built-in CSRF protection
- Type-safe function calls from client components
- Automatic error handling and serialization

Example server action structure:
```typescript
'use server'

import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function sendPortalInvitation(contactId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  
  const { knex } = await createTenantKnex();
  // Implementation here
  
  return { success: true, invitationId: '...' };
}
```

### Database Schema Considerations
The `portal_invitations` table should follow the existing pattern with tenant-based partitioning. Use UTC timestamps consistently and include proper foreign key constraints for data integrity.

```sql
CREATE TABLE portal_invitations (
  tenant UUID NOT NULL,
  invitation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL,
  token TEXT NOT NULL,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE NULL,
  metadata JSONB DEFAULT '{}',
  PRIMARY KEY (tenant, invitation_id),
  FOREIGN KEY (tenant, contact_id) REFERENCES contacts(tenant, contact_name_id),
  INDEX idx_portal_invitations_token (tenant, token),
  INDEX idx_portal_invitations_contact (tenant, contact_id)
);
```

### Token Security Best Practices
- Use `crypto.randomBytes(32).toString('hex')` for token generation
- Store tokens in database (not JWT) for better security control
- Implement token cleanup to prevent database bloat
- Use constant-time comparison for token validation

### Email Template Integration
The existing notification system uses handlebars templating. The portal invitation template should include:
- {{portalLink}} - The setup URL with token
- {{contactName}} - Contact's name
- {{companyName}} - Company name
- {{expirationTime}} - When invitation expires

### Rate Limiting Configuration
Following the existing pattern in `rateLimiting.ts`:
```typescript
const portalInvitationLimiter = new RateLimiterMemory({
  points: 3, // 3 invitations
  duration: 3600, // per hour
  blockDuration: 3600, // block for 1 hour after limit
});
```

### Frontend Error Handling
Handle specific error cases:
- Rate limit exceeded: Show time until next attempt allowed
- Contact not portal admin: Clear message about requirement
- Email sending failure: Suggest trying again or contacting support
- Network errors: Standard retry messaging

### Security Considerations
- Validate all inputs on both frontend and backend
- Use HTTPS for all portal-related URLs
- Implement CSRF protection on setup endpoints
- Log security events for monitoring
- Consider email deliverability and spam prevention

### Performance Considerations
- Token cleanup should be efficient and not block main operations
- Use database indexes for fast token lookups
- Consider adding monitoring for invitation volumes
- Email sending should be asynchronous to avoid UI blocking

## Implementer's Scratch Pad

### Notes During Implementation
```
// Track implementation progress and observations here
// Note any deviations from the plan
// Record performance metrics if collected
// Document any issues encountered and resolutions
```

### Issues Encountered
```
// Log any blocking issues or unexpected challenges
// Include resolution steps and lessons learned
// Note any changes to the original plan
```

### Testing Results
```
// Record test results for each phase
// Include performance measurements
// Note any security test outcomes
// Document user acceptance feedback
```

### Questions for Review
```
// List questions that arise during implementation
// Technical decisions that need stakeholder input
// Clarifications needed on requirements
```