# Client Portal Overview

## Overview

The Client Portal is a secure, multi-tenant web application that allows MSP clients to manage their accounts, interact with support, and access business information. This document provides an overview of the portal's architecture, authentication system, and key implementation details.

## Architecture

### Frontend Structure

**Main Application Routes:**
- `/client-portal/dashboard` - Client dashboard with account overview
- `/client-portal/tickets` - Support ticket management
- `/client-portal/projects` - Project tracking and management
- `/client-portal/billing` - Billing and invoice management
- `/client-portal/account` - Account settings and profile management
- `/client-portal/profile` - User profile management
- `/client-portal/client-settings` - Company-level settings

**Authentication Routes:**
- `/auth/client-portal/signin` - Client portal login
- `/auth/client-portal/forgot-password` - Password reset initiation
- `/auth/password-reset/set-new-password` - Password reset completion
- `/auth/portal/setup` - Account setup for invited users
- `/auth/client-portal/handoff` - Vanity domain session handoff after canonical login

### Key Components

**Authentication Components:**
- [`ClientPortalSignIn`](server/src/components/auth/ClientPortalSignIn.tsx:1) - Main sign-in container with branding support
- [`ClientLoginForm`](server/src/components/auth/ClientLoginForm.tsx:1) - Email/password login form
- [`ClientPortalLayout`](server/src/components/layout/ClientPortalLayout.tsx:1) - Portal navigation and layout

**Portal Components:**
- [`ClientDashboard`](server/src/components/client-portal/dashboard/ClientDashboard.tsx:1) - Dashboard with metrics and recent activity
- [`TicketList`](server/src/components/client-portal/tickets/TicketList.tsx:1) - Client ticket management
- [`BillingOverview`](server/src/components/client-portal/billing/BillingOverview.tsx:1) - Billing and invoice management
- [`ClientPortalSettingsPage`](server/src/components/client-portal/settings/ClientPortalSettingsPage.tsx:1) - Settings management

## Authentication System

### Authentication Flow

1. **User Access**: Client navigates to `/auth/client-portal/signin` (or is redirected there from a vanity hostname)
2. **Form Submission**: Email/password submitted via NextAuth credentials provider on the canonical host
3. **Backend Validation**: 
   - [`authenticateUser()`](server/src/lib/actions/auth.tsx:14) validates credentials
   - User type checked (`client` vs `internal`)
   - Password verified against hashed value
4. **Session Creation**: JWT token generated with user context on the canonical host
5. **Vanity Redirect**: If the tenant has an active custom domain, NextAuth issues a one-time transfer token (OTT) and redirects the browser to `https://<vanity-host>/auth/client-portal/handoff?ott=...`
6. **Session Exchange**: The handoff page calls `/api/client-portal/domain-session` to validate the OTT, verify DNS alignment, and mint a vanity-domain Auth.js cookie
7. **Access Control**: Middleware validates user type for protected routes on both canonical and vanity domains
8. **Redirect**: Successful exchange forwards the user to the requested `/client-portal/*` destination

### Security Features

**Multi-Tenant Isolation:**
- All database queries filter by `tenant` identifier
- Session tokens include tenant context
- Middleware enforces tenant-based access control

**Authentication Providers:**
- **Credentials Provider** - Email/password authentication
- **Google OAuth** - Optional OAuth authentication
- **Keycloak** - Enterprise identity management integration

**Security Measures:**
- Password hashing using bcrypt/argon2
- Optional Two-Factor Authentication (2FA) with TOTP
- Session expiration management
- Role-Based Access Control (RBAC)

### User Types

The system distinguishes between two main user types:

- **Internal Users** (`user_type: 'internal'`) - MSP staff with full system access
- **Client Users** (`user_type: 'client'`) - Client portal users with restricted access

## Backend Implementation

### Authentication Configuration

**NextAuth Setup:**
- [`server/src/app/api/auth/[...nextauth]/auth.ts`](server/src/app/api/auth/[...nextauth]/auth.ts:1) - Main auth handler
- [`server/src/app/api/auth/[...nextauth]/options.ts`](server/src/app/api/auth/[...nextauth]/options.ts:1) - Authentication configuration

**Key Authentication Methods:**
- [`authenticateUser()`](server/src/lib/actions/auth.tsx:14) - Core authentication logic
- [`User.findUserByEmailAndType()`](server/src/lib/models/user.tsx:51) - User lookup with type filtering
- [`verifyPassword()`](server/src/utils/encryption/encryption) - Password verification

### Database Models

**User Model ([`server/src/lib/models/user.tsx`](server/src/lib/models/user.tsx:1)):**
- Multi-tenant user management
- Role-based permissions
- Password hashing and verification
- 2FA secret storage

**Key User Methods:**
- `findUserByEmailAndType()` - Find user by email and type (client/internal)
- `verifyPassword()` - Password verification
- `getUserRoles()` - Role and permission lookup

### Access Control

**Middleware Protection ([`server/src/middleware.ts`](server/src/middleware.ts:75)):**
- Protects `/client-portal/*` routes
- Validates user type (`user_type === 'client'`)
- Redirects unauthorized users to appropriate login pages

**Route Protection Logic:**
```typescript
// Client portal route protection
if (pathname.startsWith(clientPortalPrefix) && !isAuthPage) {
    if (!request.auth) {
        // Redirect to client portal signin
        return NextResponse.redirect('/auth/client-portal/signin');
    } else if (request.auth.user?.user_type !== 'client') {
        // Prevent non-client users from accessing client portal
        return NextResponse.redirect('/auth/client-portal/signin?error=AccessDenied');
    }
}
```

### Vanity Domain Session Handoff

- **OTT Issuance**: Successful logins on the canonical host call `issuePortalDomainOtt()` to generate a short-lived, single-use token that stores the client user's session snapshot.
- **Handoff Page**: `/auth/client-portal/handoff` displays a lightweight loading state while exchanging the OTT for an Auth.js cookie via `/api/client-portal/domain-session`.
- **DNS Verification**: The exchange endpoint compares the vanity host's active CNAME records against `verification_details.expected_cname` and rejects handoffs when drift is detected.
- **Cookie Minting**: `buildSessionCookie()` guarantees Auth.js-compatible cookie attributes (`__Secure-` prefix, `Lax` SameSite, `Secure`, `HttpOnly`).
- **Cleanup**: Expired or consumed OTTs can be pruned with `pnpm cli portal-domain sessions prune [--tenant <tenantId>] [--minutes 10] [--dry-run]`.

## Features & Capabilities

### Core Features

**Account Management:**
- Company profile management
- User management for client organizations
- Contact information updates
- Password and security settings

**Support Ticketing:**
- Ticket creation and submission
- Ticket status tracking
- Communication with support staff
- File attachments

**Billing & Invoices:**
- Invoice viewing and download
- Payment history
- Contract Line details
- Usage metrics

**Project Management:**
- Project list with filtering (active, completed, on hold)
- Project detail views with configurable visibility
- Phase and task tracking (kanban and list views)
- Task dependencies visualization
- Document access and uploads (when enabled)

See [Client Portal Projects](client_portal_projects.md) for detailed configuration options.

### Integration Points

**Existing Component Reuse:**
- UI components from `components/ui/`
- Ticket components from `components/tickets/`
- Billing components from `components/billing-dashboard/`

**API Integration:**
- Client-specific API endpoints under `app/api/client-portal/`
- Tenant-isolated data access
- Policy-based authorization

## Configuration & Deployment

### Environment Configuration

**Authentication Secrets:**
- NextAuth secret management
- OAuth provider configurations
- Database connection settings

**Branding Configuration:**
- Tenant-specific branding (logos, colors)
- Custom domain support
- Localization settings

### Security Configuration

**Session Management:**
- JWT token configuration
- Session expiration settings
- Secure cookie settings

**Access Controls:**
- Role and permission definitions
- Policy engine configurations
- Audit logging settings

## Development & Maintenance

### Code Organization

**Frontend Structure:**
```
server/src/
├── app/client-portal/          # Client portal pages
├── components/client-portal/   # Portal-specific components
├── lib/actions/client-portal-actions/  # Client portal actions
└── lib/models/                 # Data models
```

**Backend Structure:**
```
server/src/
├── app/api/client-portal/      # Client portal API routes
├── lib/services/               # Business logic services
└── middleware/                 # Authentication middleware
```

### Testing & Quality Assurance

**Authentication Testing:**
- Unit tests for authentication logic
- Integration tests for login flows
- Security vulnerability testing

**Portal Functionality:**
- Component testing
- End-to-end user flow testing
- Performance and load testing

## Future Enhancements

### Planned Features

**Advanced Security:**
- Enhanced 2FA options (SMS, biometric)
- Session management improvements
- Advanced threat detection

**User Experience:**
- Mobile app development
- Offline functionality
- Enhanced reporting capabilities

**Integration:**
- Additional OAuth providers
- API gateway enhancements
- Third-party service integrations

## Support & Troubleshooting

### Common Issues

**Authentication Problems:**
- Password reset failures
- Session expiration issues
- Tenant context errors

**Access Control:**
- Permission denied errors
- Role assignment issues
- Tenant isolation problems

### Monitoring & Logging

**Key Metrics:**
- Authentication success/failure rates
- User activity patterns
- Performance metrics

**Logging:**
- Authentication attempts
- Security events
- System errors

---

*This document provides a comprehensive overview of the Client Portal implementation. For detailed technical specifications, refer to the individual component documentation and source code.*
