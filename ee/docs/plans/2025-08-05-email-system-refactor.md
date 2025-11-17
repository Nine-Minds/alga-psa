/# Email System Refactoring Plan

## Intro / Rationale

### Executive Summary
The current email system has duplicate implementations and lacks clear separation between system-level emails and tenant-specific business emails. This refactoring will establish a clear architectural pattern that distinguishes between:

- **System Emails**: Platform-level emails (user registration, password reset, system notifications) using environment variables
- **Tenant Emails**: Business-specific emails (portal invitations, invoices, project notifications) using database-configured settings

### Business and Technical Drivers
- **Code Duplication**: Two separate EmailService implementations exist with overlapping functionality
- **Architectural Confusion**: Email verification incorrectly uses TenantEmailService when it should use system settings
- **Maintenance Overhead**: Scattered email logic makes updates and bug fixes difficult
- **Scalability Issues**: No clear pattern for adding new email types

### Success Criteria
- Single, clear EmailService implementation for system emails using environment variables
- Properly separated TenantEmailService for business emails using database settings
- Email verification and password reset using SystemEmailService
- Portal invitations and business emails continue using TenantEmailService
- Clear documentation and examples for future development

### Key Stakeholders
- Development team implementing new email features
- Operations team managing email configuration
- End users receiving system and business emails

## Phased Implementation Checklist

### Phase 1: System Email Service Consolidation
**Goal**: Create unified SystemEmailService for all platform-level emails

- [ ] **Task 1.1**: Create new directory structure
  - [ ] Create `/src/lib/email/system/` directory
  - [ ] Create `/src/lib/email/tenant/` directory
- [ ] **Task 1.2**: Consolidate duplicate EmailService implementations
  - [ ] Analyze differences between `/src/services/emailService.ts` and `/src/lib/notifications/emailService.ts`
  - [ ] Create unified `SystemEmailService.ts` in `/src/lib/email/system/`
  - [ ] Implement environment variable configuration exclusively
  - [ ] Add comprehensive logging and error handling
- [ ] **Task 1.3**: Create system email templates
  - [ ] Move system templates to `/src/lib/email/system/templates/`
  - [ ] Create `emailVerification.ts` template
  - [ ] Create `passwordReset.ts` template  
  - [ ] Create `systemNotification.ts` template
- [ ] **Task 1.4**: Create system email types
  - [ ] Create `/src/lib/email/system/types.ts` with SystemEmailOptions interface
  - [ ] Define SystemEmailConfig interface
  - [ ] Export template interfaces

**Dependencies**: None  
**Completion Criteria**: SystemEmailService can send emails using environment variables, all system templates are available

### Phase 2: Tenant Email Service Migration
**Goal**: Move and enhance existing TenantEmailService to new structure

- [ ] **Task 2.1**: Move TenantEmailService to new location
  - [ ] Move `TenantEmailService.ts` to `/src/lib/email/tenant/`
  - [ ] Move `templateProcessors.ts` to `/src/lib/email/tenant/`
  - [ ] Update all import paths referencing moved files
- [ ] **Task 2.2**: Enhance TenantEmailService documentation
  - [ ] Add comprehensive JSDoc comments explaining tenant email purpose
  - [ ] Document when to use TenantEmailService vs SystemEmailService
  - [ ] Add usage examples in code comments
- [ ] **Task 2.3**: Create tenant email types
  - [ ] Create `/src/lib/email/tenant/types.ts`
  - [ ] Move tenant-specific interfaces from existing files
  - [ ] Ensure clear separation from system email types

**Dependencies**: Phase 1 completion  
**Completion Criteria**: TenantEmailService is in new location with enhanced documentation, all imports updated

### Phase 3: Email Function Updates
**Goal**: Update specific email functions to use correct service

- [ ] **Task 3.1**: Update email verification to use SystemEmailService
  - [ ] Modify `/src/lib/email/sendVerificationEmail.ts` to import SystemEmailService
  - [ ] Replace TenantEmailService.sendEmail() call with SystemEmailService
  - [ ] Update template processor to use system templates
  - [ ] Test email verification flow works with environment variables
- [ ] **Task 3.2**: Ensure password reset uses SystemEmailService  
  - [ ] Locate password reset email functions
  - [ ] Update to use SystemEmailService instead of any tenant service calls
  - [ ] Verify password reset templates are in system templates directory
- [ ] **Task 3.3**: Verify portal invitations continue using TenantEmailService
  - [ ] Confirm `/src/lib/email/sendPortalInvitationEmail.ts` uses TenantEmailService
  - [ ] Update import paths to new tenant service location
  - [ ] Test portal invitation flow still works correctly

**Dependencies**: Phase 2 completion  
**Completion Criteria**: Email verification and password reset use SystemEmailService, portal invitations use TenantEmailService

### Phase 4: Email Service Factory and Integration
**Goal**: Create centralized factory and update integration points

- [ ] **Task 4.1**: Create email service factory
  - [ ] Create `/src/lib/email/index.ts` as main entry point
  - [ ] Export `getSystemEmailService()` function
  - [ ] Export `getTenantEmailService()` function  
  - [ ] Re-export key types and interfaces
- [ ] **Task 4.2**: Update application integration points
  - [ ] Update all files importing old EmailService locations
  - [ ] Replace direct service instantiation with factory functions
  - [ ] Update API routes and actions to use correct email service
- [ ] **Task 4.3**: Clean up old implementations
  - [ ] Remove `/src/services/emailService.ts` after confirming no references
  - [ ] Remove `/src/lib/notifications/emailService.ts` after confirming no references
  - [ ] Remove `/src/utils/email/emailService.tsx` if unused

**Dependencies**: Phase 3 completion  
**Completion Criteria**: Single entry point for email services, old implementations removed, all imports updated

### Phase 5: Documentation and Guidelines
**Goal**: Create comprehensive documentation for email system usage

- [ ] **Task 5.1**: Create main email documentation
  - [ ] Create `/src/lib/email/README.md` with comprehensive guidelines
  - [ ] Document when to use SystemEmailService vs TenantEmailService
  - [ ] Provide code examples for common email scenarios

**Dependencies**: Phase 4 completion  
**Completion Criteria**: Complete documentation available, clear guidelines for future development

## Background Details / Investigation / Implementation Advice

### Current System Analysis

#### Duplicate EmailService Implementations
Two separate EmailService classes exist:

1. **`/src/services/emailService.ts`**: 
   - Uses both environment variables and database templates
   - Includes invoice email functionality
   - Has comprehensive logging and error handling
   - Contains template fallback logic

2. **`/src/lib/notifications/emailService.ts`**:
   - Uses environment variables exclusively
   - Includes Handlebars template compilation
   - Simpler implementation focused on notifications

#### Key Issues Identified
- Email verification uses TenantEmailService but should use system settings
- Template storage is inconsistent (hardcoded vs database)
- No clear naming convention to distinguish email types
- Import paths are scattered across different directories

### Technical Implementation Guidelines

#### SystemEmailService Requirements
- **Configuration**: Environment variables only (EMAIL_HOST, EMAIL_PORT, EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_FROM)
- **Templates**: Static templates in code or system template table
- **Use Cases**: User registration, password reset, system alerts, platform notifications
- **Initialization**: Singleton pattern with lazy initialization
- **Error Handling**: Comprehensive logging with diagnostic information

#### TenantEmailService Requirements  
- **Configuration**: Database-stored tenant email settings
- **Templates**: Database templates with tenant-specific customization
- **Use Cases**: Portal invitations, invoices, project notifications, business communications
- **Provider Support**: Multiple email provider configurations per tenant
- **Template Processing**: Support for complex template data and variables

#### Directory Structure Implementation
```
/src/lib/email/
├── index.ts                    # Main factory and exports
├── README.md                   # Comprehensive documentation
├── system/
│   ├── SystemEmailService.ts  # Environment-based email service
│   ├── templates/
│   │   ├── emailVerification.ts
│   │   ├── passwordReset.ts
│   │   └── systemNotification.ts
│   └── types.ts               # System email interfaces
└── tenant/
    ├── TenantEmailService.ts  # Database-based email service
    ├── templateProcessors.ts  # Template processing logic
    └── types.ts               # Tenant email interfaces
```

#### Migration Strategy
1. **Preserve Functionality**: Ensure zero downtime during migration
2. **Gradual Transition**: Update services one at a time with testing
3. **Import Path Updates**: Use find-replace to update import statements systematically
4. **Template Migration**: Move templates without changing their content initially

#### Testing Approach
- Test system emails with environment variable configuration
- Test tenant emails with database configuration
- Verify email verification flow uses system service
- Verify portal invitations use tenant service
- Test error handling for missing configuration

#### Potential Pitfalls and Solutions

**Pitfall**: Breaking existing email functionality during migration  
**Solution**: Update one service at a time, maintain parallel implementations during transition

**Pitfall**: Template references breaking after file moves  
**Solution**: Update all import paths in single atomic operation, use IDE refactoring tools

**Pitfall**: Configuration conflicts between system and tenant emails  
**Solution**: Clearly separate configuration sources, add validation for each service type

**Pitfall**: Missing error handling in new implementations  
**Solution**: Copy comprehensive error handling from existing services, add diagnostic logging

### Code Examples

#### SystemEmailService Usage
```typescript
import { getSystemEmailService } from '@/lib/email';

const emailService = await getSystemEmailService();
await emailService.sendVerificationEmail({
  to: 'user@example.com',
  templateData: { verificationUrl: 'https://...' }
});
```

#### TenantEmailService Usage
```typescript
import { getTenantEmailService } from '@/lib/email';

const result = await TenantEmailService.sendEmail({
  tenantId: 'tenant-123',
  to: 'client@company.com',
  templateProcessor: new DatabaseTemplateProcessor(knex, 'portal-invitation'),
  templateData: { portalLink: 'https://...' }
});
```

### Resources and References
- Current TenantEmailService implementation: `/src/lib/services/TenantEmailService.ts`
- Email provider management: `/src/services/email/EmailProviderManager.ts`
- Template processing: `/src/lib/services/email/templateProcessors.ts`
- Email types: `/src/types/email.types.ts`

## Implementer's Scratch Pad

### Progress Tracking
- [ ] Phase 1 started: ___________
- [ ] Phase 1 completed: ___________
- [ ] Phase 2 started: ___________
- [ ] Phase 2 completed: ___________
- [ ] Phase 3 started: ___________
- [ ] Phase 3 completed: ___________
- [ ] Phase 4 started: ___________
- [ ] Phase 4 completed: ___________
- [ ] Phase 5 started: ___________
- [ ] Phase 5 completed: ___________

### Implementation Notes
```
Phase 1 Notes:
- SystemEmailService consolidation status: 
- Template migration status:
- Environment variable testing:

Phase 2 Notes:
- TenantEmailService move status:
- Import path updates:
- Documentation additions:

Phase 3 Notes:
- Email verification update status:
- Password reset verification:
- Portal invitation testing:

Phase 4 Notes:
- Factory implementation:
- Integration point updates:
- Cleanup completion:

Phase 5 Notes:
- Documentation completeness:
- Example code validation:
- Final review status:
```

### Issues Encountered and Resolutions
```
Issue 1: [Description]
Resolution: [How resolved]
Impact: [Impact on timeline/scope]

Issue 2: [Description]  
Resolution: [How resolved]
Impact: [Impact on timeline/scope]
```

### Deviations From Original Plan
```
Deviation 1: [What changed]
Reason: [Why it changed]
Approval: [Who approved change]

Deviation 2: [What changed]
Reason: [Why it changed]  
Approval: [Who approved change]
```

### Performance Metrics and Test Results
```
Email Verification Tests:
- System service configuration: [PASS/FAIL]
- Template rendering: [PASS/FAIL]
- Email delivery: [PASS/FAIL]

Portal Invitation Tests:
- Tenant service configuration: [PASS/FAIL]
- Database template retrieval: [PASS/FAIL]
- Email delivery: [PASS/FAIL]

Integration Tests:
- Import path updates: [PASS/FAIL]
- Service factory: [PASS/FAIL]
- Error handling: [PASS/FAIL]
```

### Questions for Review
```
1. [Question about implementation approach]
2. [Question about configuration]
3. [Question about testing strategy]
```