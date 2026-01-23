# Tenant Customer Tracking Implementation Plan

## Intro / Rationale

### Executive Summary
Currently, the tenant creation workflow creates records only within the new tenant's database. To enable proper business management and customer relationship tracking, we need to enhance the system to simultaneously create customer records in the nineminds (management) tenant for each newly provisioned tenant.

### Business Drivers
- **Customer Lifecycle Management**: Track all tenants as customers in a centralized management database
- **Business Intelligence**: Enable reporting and analytics across all provisioned tenants
- **Account Management**: Provide a unified view of all customer accounts for business operations
- **Revenue Tracking**: Associate billing and revenue data with customer records
- **Support Operations**: Enable cross-tenant customer support and account management

### Success Criteria
- Every new tenant is automatically tracked as a customer in the nineminds tenant
- Admin users from new tenants are created as contacts in the nineminds tenant
- Customer records are tagged appropriately for easy identification
- Existing tenant creation workflow remains fully backward compatible
- Shared model logic can be reused across different contexts (with and without user sessions)

### Key Stakeholders
- **Business Operations**: Centralized customer management capabilities
- **Development Team**: Maintainable, reusable code architecture
- **System Administrators**: Reliable tenant provisioning process
- **Customer Support**: Access to comprehensive customer information

## Phased Implementation Checklist

### Phase 1: Foundation Setup
**Goal**: Create shared model components and validate approach
**Completion Criteria**: Shared model components created and tested in isolation

- [ ] **Task 1**: Create shared company model
  - [ ] Extract company creation logic from `companyActions.ts` 
  - [ ] Remove user context dependencies (getCurrentUser, hasPermission)
  - [ ] Create `shared/models/companyModel.ts` (following the pattern of `ticketModel.ts`)
  - [ ] Include website domain extraction and tax settings creation
  - [ ] **Estimated Time**: 4 hours

- [ ] **Task 2**: Create shared contact model  
  - [ ] Extract contact creation logic from `contactActions.tsx`
  - [ ] Remove user context dependencies
  - [ ] Create `shared/models/contactModel.ts` (following the pattern of `ticketModel.ts`)
  - [ ] Include email validation and company linking
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 3**: Create shared tag model
  - [ ] Extract tag creation logic from `tagActions.ts`
  - [ ] Remove user context dependencies  
  - [ ] Create `shared/models/tagModel.ts` (following the pattern of `ticketModel.ts`)
  - [ ] Include color generation and definition management
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 4**: Update existing server actions to use shared models
  - [ ] Modify `companyActions.ts` to use CompanyModel
  - [ ] Modify `contactActions.tsx` to use ContactModel  
  - [ ] Modify `tagActions.ts` to use TagModel
  - [ ] Ensure backward compatibility with all existing functionality
  - [ ] Run full test suite to verify no regressions
  - [ ] **Estimated Time**: 6 hours

**Dependencies**: None
**Verification Steps**: 
- All existing functionality works without changes
- New shared models pass unit tests
- Integration tests pass for existing workflows

### Phase 2: Customer Tracking Logic
**Goal**: Implement nineminds tenant customer tracking functionality
**Completion Criteria**: Customer tracking activities work in isolation

- [ ] **Task 5**: Implement customer company creation activity
  - [ ] Create `createCustomerCompanyActivity` in temporal workflows
  - [ ] Use CompanyModel with nineminds tenant database connection
  - [ ] Include proper error handling and rollback capabilities
  - [ ] Add activity-level unit tests
  - [ ] **Estimated Time**: 4 hours

- [ ] **Task 6**: Implement customer contact creation activity
  - [ ] Create `createCustomerContactActivity` in temporal workflows
  - [ ] Use ContactModel with nineminds tenant database connection
  - [ ] Link contact to customer company
  - [ ] Add activity-level unit tests
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 7**: Implement customer tagging activity
  - [ ] Create `tagCustomerCompanyActivity` in temporal workflows
  - [ ] Use TagModel to apply "PSA Customer" tag
  - [ ] Handle tag creation if it doesn't exist
  - [ ] Add activity-level unit tests
  - [ ] **Estimated Time**: 2 hours

- [ ] **Task 8**: Add nineminds tenant configuration
  - [ ] Create configuration mechanism to identify nineminds tenant
  - [ ] Add environment variable or database configuration
  - [ ] Include validation to ensure nineminds tenant exists
  - [ ] Add configuration tests
  - [ ] **Estimated Time**: 2 hours

**Dependencies**: Phase 1 completion
**Verification Steps**:
- Activities can create customer records in nineminds tenant
- Proper error handling and rollback behavior
- All activity tests pass

### Phase 3: Workflow Integration  
**Goal**: Integrate customer tracking into tenant creation workflow
**Completion Criteria**: Complete tenant creation includes customer tracking

- [ ] **Task 9**: Extend tenant creation workflow
  - [ ] Add customer tracking steps to `tenant-creation-workflow.ts`
  - [ ] Maintain existing workflow steps and behavior
  - [ ] Add proper error handling and rollback for customer tracking steps
  - [ ] Update workflow state tracking to include customer creation status
  - [ ] **Estimated Time**: 4 hours

- [ ] **Task 10**: Update workflow activity definitions
  - [ ] Add new activities to activity proxy definitions
  - [ ] Configure appropriate timeouts and retry policies
  - [ ] Ensure activities are properly typed
  - [ ] **Estimated Time**: 1 hour

- [ ] **Task 11**: Implement customer tracking rollback
  - [ ] Add rollback activities for customer company and contact
  - [ ] Include rollback in main workflow error handling
  - [ ] Ensure rollback works for partial failures
  - [ ] Test rollback scenarios comprehensively
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 12**: Update workflow result types
  - [ ] Extend `TenantCreationResult` to include customer tracking info
  - [ ] Update workflow state types for customer creation steps
  - [ ] Ensure backward compatibility with existing consumers
  - [ ] **Estimated Time**: 1 hour

**Dependencies**: Phase 2 completion
**Verification Steps**:
- Tenant creation workflow includes customer tracking
- Failed tenant creation properly rolls back customer records
- Workflow result includes customer tracking information

### Phase 4: Validation and Documentation
**Goal**: Validate functionality and document the implementation
**Completion Criteria**: Feature works correctly, no regressions, documentation complete

- [ ] **Task 13**: Manual validation
  - [ ] Validate complete tenant creation workflow with customer tracking
  - [ ] Validate rollback scenarios for various failure points
  - [ ] Validate with different tenant configurations and data
  - [ ] Verify customer records are created correctly in nineminds tenant
  - [ ] **Estimated Time**: 4 hours

- [ ] **Task 14**: Performance validation
  - [ ] Measure impact on tenant creation workflow performance
  - [ ] Ensure customer tracking doesn't significantly slow down process
  - [ ] Validate with concurrent tenant creation scenarios
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 15**: Error scenario validation
  - [ ] Validate nineminds tenant unavailable scenarios
  - [ ] Validate partial customer creation failures
  - [ ] Validate rollback behavior under various conditions
  - [ ] Verify graceful degradation when customer tracking fails
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 16**: Documentation
  - [ ] Update workflow documentation
  - [ ] Document new shared model components
  - [ ] Create troubleshooting guide
  - [ ] Document configuration requirements
  - [ ] **Estimated Time**: 3 hours

**Dependencies**: Phase 3 completion
**Verification Steps**:
- All functionality works as expected
- Customer tracking flow operates correctly
- Performance meets acceptable thresholds
- Error scenarios are handled gracefully

### Phase 5: Deployment and Monitoring
**Goal**: Deploy to production with proper monitoring and rollback capability
**Completion Criteria**: Feature deployed, monitored, and working in production

- [ ] **Task 17**: Create deployment configuration
  - [ ] Update environment variables for nineminds tenant identification
  - [ ] Create database migration scripts if needed
  - [ ] Update Docker and Kubernetes configurations
  - [ ] **Estimated Time**: 2 hours

- [ ] **Task 18**: Deploy to staging environment
  - [ ] Test complete functionality in staging environment
  - [ ] Validate customer record creation in staging nineminds tenant
  - [ ] Run full regression test suite
  - [ ] **Estimated Time**: 3 hours

- [ ] **Task 19**: Production deployment
  - [ ] Deploy changes to production environment
  - [ ] Monitor tenant creation workflows for any issues
  - [ ] Verify customer records are being created correctly
  - [ ] **Estimated Time**: 2 hours

- [ ] **Task 20**: Post-deployment validation
  - [ ] Monitor workflow execution metrics
  - [ ] Validate customer record creation over first 24 hours
  - [ ] Check for any error patterns or performance issues
  - [ ] **Estimated Time**: 4 hours

**Dependencies**: Phase 4 completion
**Verification Steps**:
- Feature works correctly in production
- No performance degradation
- Customer records created for all new tenants

## Background Details / Investigation / Implementation Advice

### Technical Architecture

#### Shared Model Architecture
The shared model components will follow the pattern established by `ticketModel.ts`:

```typescript
// shared/models/companyModel.ts
import { Knex } from 'knex';
import { z } from 'zod';

// Validation schemas
export const companyFormSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  client_type: z.enum(['company', 'individual']).optional(),
  url: z.string().optional(),
  // ... other company fields
});

// Interfaces
export interface CreateCompanyInput {
  company_name: string;
  url?: string;
  client_type?: 'company' | 'individual';
  properties?: Record<string, any>;
  notes?: string;
  // ... other company fields
}

export interface CreateCompanyOutput {
  company_id: string;
  company_name: string;
  tenant: string;
  created_at: string;
}

// Core Model Class
export class CompanyModel {
  /**
   * Validates company creation input
   */
  static validateCreateCompanyInput(input: CreateCompanyInput): ValidationResult {
    // Validation logic
  }
  
  /**
   * Create a new company with complete validation and business rules
   */
  static async createCompany(
    input: CreateCompanyInput,
    tenant: string,
    trx: Knex.Transaction,
    options?: { skipTaxSettings?: boolean; skipEmailSuffix?: boolean }
  ): Promise<CreateCompanyOutput> {
    // Core company creation logic without user context
  }
}
```

#### Database Connection Strategy
Use the existing `getAdminConnection()` for nineminds tenant operations:

```typescript
// In temporal activities
import { CompanyModel } from '@alga-psa/shared/models/companyModel';

export async function createCustomerCompanyActivity(input: {
  tenantName: string;
  companyName: string;
}): Promise<{ customerId: string }> {
  const adminKnex = await getAdminConnection();
  const ninemindsEtenant = process.env.NINEMINDS_TENANT_ID;
  
  const result = await adminKnex.transaction(async (trx) => {
    return await CompanyModel.createCompany(
      {
        company_name: input.tenantName,
        client_type: 'company'
      },
      ninemindsEtenant,
      trx
    );
  });
  
  return { customerId: result.company_id };
}
```

### Key Implementation Considerations

#### 1. Error Handling Strategy
- **Graceful Degradation**: Customer tracking failures should not prevent tenant creation
- **Comprehensive Rollback**: Failed tenant creation should clean up customer records
- **Detailed Logging**: Track customer creation steps for troubleshooting

#### 2. Data Synchronization
- **Tenant Name Mapping**: Use tenant name as company name in nineminds tenant
- **Email Consistency**: Admin user email should match between tenants
- **Tag Standardization**: Use consistent tagging scheme ("PSA Customer")

#### 3. Performance Considerations  
- **Parallel Execution**: Customer tracking activities can run in parallel with other setup
- **Database Connection Pooling**: Reuse connections efficiently
- **Activity Timeouts**: Set appropriate timeouts for customer tracking activities

#### 4. Security Considerations
- **Access Control**: Ensure temporal activities can access nineminds tenant
- **Data Validation**: Validate all input data before creating customer records
- **Audit Logging**: Log all customer creation activities for compliance

### Code Examples

#### Shared Company Model Implementation
```typescript
// shared/models/companyModel.ts
export class CompanyModel {
  /**
   * Validates company creation input
   */
  static validateCreateCompanyInput(input: CreateCompanyInput): ValidationResult {
    try {
      // Basic required field validation
      if (!input.company_name || input.company_name.trim() === '') {
        return { valid: false, errors: ['Company name is required'] };
      }

      const validatedData = validateData(companyFormSchema, input);
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Create a new company with complete validation
   */
  static async createCompany(
    input: CreateCompanyInput,
    tenant: string,
    trx: Knex.Transaction,
    options: CompanyCreationOptions = {}
  ): Promise<CreateCompanyOutput> {
    // Validate input
    const validation = this.validateCreateCompanyInput(input);
    if (!validation.valid) {
      throw new Error(`Company validation failed: ${validation.errors?.join('; ')}`);
    }

    const companyId = uuidv4();
    const now = new Date();

    // Sync website fields
    const companyData = { ...input };
    if (companyData.properties?.website && !companyData.url) {
      companyData.url = companyData.properties.website;
    }
    if (companyData.url && (!companyData.properties || !companyData.properties.website)) {
      if (!companyData.properties) {
        companyData.properties = {};
      }
      companyData.properties.website = companyData.url;
    }

    // Create company record
    const [company] = await trx('companies')
      .insert({
        company_id: companyId,
        ...companyData,
        tenant,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      })
      .returning('*');
    
    // Create default tax settings if not skipped
    if (!options.skipTaxSettings) {
      await this.createDefaultTaxSettings(company.company_id, tenant, trx);
    }
    
    // Add website domain as email suffix if available and not skipped
    if (!options.skipEmailSuffix && companyData.url) {
      const domain = this.extractDomainFromUrl(companyData.url);
      if (domain) {
        await this.addCompanyEmailSetting(company.company_id, domain, tenant, trx);
      }
    }
    
    return {
      company_id: company.company_id,
      company_name: company.company_name,
      tenant,
      created_at: now.toISOString()
    };
  }

  // Helper methods
  static extractDomainFromUrl(url: string): string | null {
    // Implementation from existing code
  }

  static async createDefaultTaxSettings(
    companyId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Implementation from existing code
  }

  static async addCompanyEmailSetting(
    companyId: string,
    domain: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Implementation from existing code
  }
}
```

#### Customer Tracking Activity
```typescript
// ee/temporal-workflows/src/activities/customer-tracking-activities.ts
import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin';
import { CompanyModel } from '@alga-psa/shared/models/companyModel';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { TagModel } from '@alga-psa/shared/models/tagModel';

export async function createCustomerCompanyActivity(input: {
  tenantName: string;
  adminUserEmail: string;
}): Promise<{ customerId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsEtenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Creating customer company in nineminds tenant', {
      tenantName: input.tenantName,
      ninemindsEtenant
    });
    
    const result = await adminKnex.transaction(async (trx) => {
      return await CompanyModel.createCompany(
        {
          company_name: input.tenantName,
          client_type: 'company',
          url: '', // No website for tenant companies initially
          notes: `PSA Customer - Tenant: ${input.tenantName}`,
          properties: {
            tenant_id: input.tenantName,
            subscription_type: 'psa'
          }
        },
        ninemindsEtenant,
        trx,
        { skipEmailSuffix: true } // Skip email suffix for tenant companies
      );
    });
    
    log.info('Customer company created successfully', {
      customerId: result.company_id,
      tenantName: input.tenantName
    });
    
    return { customerId: result.company_id };
  } catch (error) {
    log.error('Failed to create customer company', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantName: input.tenantName
    });
    throw error;
  }
}

export async function createCustomerContactActivity(input: {
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<{ contactId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsEtenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Creating customer contact in nineminds tenant', {
      email: input.email,
      companyId: input.companyId
    });
    
    const result = await adminKnex.transaction(async (trx) => {
      return await ContactModel.createContact(
        {
          full_name: `${input.firstName} ${input.lastName}`,
          email: input.email,
          company_id: input.companyId,
          role: 'Admin',
          notes: 'Primary admin for PSA tenant'
        },
        ninemindsEtenant,
        trx
      );
    });
    
    log.info('Customer contact created successfully', {
      contactId: result.contact_id,
      email: input.email
    });
    
    return { contactId: result.contact_id };
  } catch (error) {
    log.error('Failed to create customer contact', {
      error: error instanceof Error ? error.message : 'Unknown error',
      email: input.email
    });
    throw error;
  }
}

export async function tagCustomerCompanyActivity(input: {
  companyId: string;
  tagText: string;
}): Promise<{ tagId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsEtenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Tagging customer company', {
      companyId: input.companyId,
      tagText: input.tagText
    });
    
    const result = await adminKnex.transaction(async (trx) => {
      return await TagModel.createTag(
        {
          tag_text: input.tagText,
          tagged_id: input.companyId,
          tagged_type: 'company',
          created_by: 'system'
        },
        ninemindsEtenant,
        trx
      );
    });
    
    log.info('Customer company tagged successfully', {
      tagId: result.tag_id,
      companyId: input.companyId
    });
    
    return { tagId: result.tag_id };
  } catch (error) {
    log.error('Failed to tag customer company', {
      error: error instanceof Error ? error.message : 'Unknown error',
      companyId: input.companyId
    });
    throw error;
  }
}
```

### Migration Strategy

#### Phase 1: Parallel Implementation
- Implement shared models alongside existing code
- No changes to existing functionality during development
- Extensive testing of shared model components in isolation

#### Phase 2: Gradual Replacement
- Update existing server actions to use shared models
- Maintain 100% backward compatibility
- Monitor for any behavioral changes

#### Phase 3: Workflow Enhancement
- Add customer tracking as additional steps
- Ensure tenant creation can complete even if customer tracking fails
- Comprehensive error handling and rollback

### Risk Mitigation

#### High-Risk Areas
1. **Database Connection Issues**: Nineminds tenant unavailable
   - Mitigation: Graceful degradation, retry mechanisms
2. **Performance Impact**: Additional database operations slow down tenant creation
   - Mitigation: Parallel execution, connection pooling
3. **Data Inconsistency**: Customer records created but tenant creation fails
   - Mitigation: Comprehensive rollback activities

#### Validation Strategy
- **Manual Validation**: Verify each component works correctly
- **Workflow Validation**: Ensure customer tracking works in workflows
- **Performance Monitoring**: Ensure acceptable response times
- **Error Scenario Validation**: Simulate nineminds tenant failures

### Configuration Requirements

#### Environment Variables
```bash
# Nineminds tenant identification
NINEMINDS_TENANT_ID=uuid-of-nineminds-tenant

# Customer tracking configuration
ENABLE_CUSTOMER_TRACKING=true
CUSTOMER_TAG_NAME="PSA Customer"
```

#### Database Requirements
- Nineminds tenant must exist and be accessible
- Standard company, contact, and tag tables must exist in nineminds tenant
- Temporal worker must have database access to nineminds tenant

### Monitoring and Alerting

#### Key Metrics
- Customer company creation success rate
- Customer contact creation success rate
- Customer tracking rollback frequency
- Tenant creation workflow duration impact

#### Alert Conditions
- Customer tracking failure rate > 5%
- Nineminds tenant connection failures
- Customer tracking rollback frequency > 1%
- Significant increase in tenant creation duration

## Implementer's Scratch Pad

### Progress Tracking
Use this section to track implementation progress, issues encountered, and decisions made:

#### Implementation Notes
```
Date: ___________
Implementer: ___________

Phase 1 Progress:
- [ ] Shared company logic created
- [ ] Shared contact logic created  
- [ ] Shared tag logic created
- [ ] Existing actions updated

Issues Encountered:
- 

Deviations from Plan:
- 

Performance Observations:
- 
```

#### Validation Results
```
Manual Validation:
- Shared company model: _____ working/not working
- Shared contact model: _____ working/not working
- Shared tag model: _____ working/not working

Workflow Validation:
- Customer company creation: _____ working/not working
- Customer contact creation: _____ working/not working
- Customer tagging: _____ working/not working
- Rollback scenarios: _____ working/not working

Performance Benchmarks:
- Baseline tenant creation time: _____ ms
- With customer tracking time: _____ ms
- Performance impact: _____ % increase
```

#### Production Deployment Log
```
Deployment Date: ___________
Environment: ___________

Pre-deployment Checklist:
- [ ] Environment variables configured
- [ ] Nineminds tenant ID verified
- [ ] Database migrations applied
- [ ] Staging validation completed

Post-deployment Monitoring:
- First 1 hour: _____ tenant creations, _____ customer records created
- First 24 hours: _____ tenant creations, _____ customer records created
- Error rate: _____ %
- Average response time impact: _____ ms

Issues Identified:
- 

Resolution Actions:
- 
```

#### Review and Feedback
```
Code Review Completed By: ___________
Date: ___________

Key Feedback Points:
- 

Security Review Completed By: ___________  
Date: ___________

Security Concerns:
- 

Business Review Completed By: ___________
Date: ___________

Business Requirements Validation:
- [ ] Customer records created correctly
- [ ] Admin users become contacts
- [ ] Proper tagging applied
- [ ] No impact on tenant creation reliability
```

#### Questions for Review
```
Technical Questions:
1. Should customer tracking failure cause tenant creation to fail?
2. What's the acceptable performance impact threshold?
3. How should we handle nineminds tenant unavailability?

Business Questions:  
1. What additional customer data should be captured?
2. Should existing tenants be retroactively added as customers?
3. What reporting requirements exist for customer data?

Operational Questions:
1. Who should have access to customer records in nineminds tenant?
2. What backup/recovery procedures are needed?
3. How should customer data be maintained over time?
```

### Final Implementation Checklist
- [ ] All phases completed successfully
- [ ] Customer records created for all new tenants
- [ ] No performance degradation beyond acceptable limits
- [ ] No impact on existing tenant creation reliability
- [ ] Monitoring and alerting in place
- [ ] Documentation updated
- [ ] Team training completed
- [ ] Rollback procedures validated and documented

**Total Estimated Implementation Time**: 50 hours across 5 phases
**Recommended Team Size**: 2-3 developers
**Timeline**: 2 weeks

---

*Plan created on: 2025-01-08*  
*Last updated: 2025-01-08*  
*Plan version: 1.0*