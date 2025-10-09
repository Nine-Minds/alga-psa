# Tenant Onboarding Process

## Overview

The tenant onboarding process is a fully automated workflow that provisions new tenants in the Alga PSA system. This process uses Temporal workflows to ensure reliability, consistency, and proper error handling throughout the tenant creation process.

## Architecture

### Components

- **Temporal Workflows**: Orchestrate the multi-step tenant creation process
- **Database Operations**: Handle tenant, user, and company creation in PostgreSQL
- **Email Service**: Send welcome emails to new admin users
- **Rollback System**: Automatic cleanup in case of failures

### Key Files

- `ee/temporal-workflows/src/workflows/tenant-creation-workflow.ts` - Main workflow orchestration
- `ee/temporal-workflows/src/db/tenant-operations.ts` - Database operations for tenant setup
- `ee/temporal-workflows/src/db/user-operations.ts` - User creation and management
- `ee/temporal-workflows/src/services/email-service.ts` - Email notification service

## Workflow Steps

### 1. Tenant Creation (`creating_tenant`)
- Creates tenant record in `tenants` table
- Optionally creates company record in `companies` table
- Establishes tenant-company relationship
- **Progress**: 10% → 40%

### 2. Admin User Creation (`creating_admin_user`)
- Creates admin user in `users` table
- Assigns admin role via `user_roles` table
- Generates temporary password
- **Progress**: 40% → 60%

### 3. Tenant Data Setup (`setting_up_data`)
- Configures tenant email settings in `tenant_email_settings`
- Sets up tenant-company associations in `tenant_companies`
- Initializes default configurations
- **Progress**: 60% → 85%

### 4. Welcome Email (`sending_welcome_email`)
- Sends welcome email to admin user
- Includes login credentials and setup instructions
- **Progress**: 85% → 100%

## Database Schema

### Core Tables

```sql
-- Tenant record
tenants (
  tenant VARCHAR PRIMARY KEY,
  company_name VARCHAR,
  email VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Company record
companies (
  company_id VARCHAR PRIMARY KEY,
  company_name VARCHAR,
  tenant VARCHAR REFERENCES tenants(tenant),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Admin user
users (
  user_id VARCHAR PRIMARY KEY,
  tenant VARCHAR REFERENCES tenants(tenant),
  first_name VARCHAR,
  last_name VARCHAR,
  email VARCHAR,
  password_hash VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- User roles
user_roles (
  user_id VARCHAR REFERENCES users(user_id),
  role_id VARCHAR,
  tenant VARCHAR REFERENCES tenants(tenant),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Email settings
tenant_email_settings (
  tenant_id VARCHAR,
  email_provider VARCHAR DEFAULT 'resend',
  fallback_enabled BOOLEAN DEFAULT true,
  tracking_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Tenant-company associations
tenant_companies (
  tenant VARCHAR REFERENCES tenants(tenant),
  company_id VARCHAR REFERENCES companies(company_id),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

## API Usage

### Starting a Tenant Creation Workflow

```typescript
import { Client } from '@temporalio/client';

const client = new Client({ address: 'localhost:7233' });

const result = await client.workflow.start('tenantCreationWorkflow', {
  workflowId: `tenant-creation-${Date.now()}`,
  taskQueue: 'tenant-creation',
  args: [{
    tenantName: 'Acme Corp',
    adminUser: {
      firstName: 'John',
      lastName: 'Doe', 
      email: 'john.doe@acme.com'
    },
    companyName: 'Acme Corporation',
    contractLine: 'professional'
  }]
});

// Monitor progress
const handle = client.workflow.getHandle(result.workflowId);
const state = await handle.query('getState');
console.log('Current step:', state.step, 'Progress:', state.progress + '%');
```

### Input Parameters

```typescript
interface TenantCreationInput {
  tenantName: string;              // Display name for the tenant
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;                 // Admin user email (also used for tenant)
  };
  companyName?: string;            // Optional company name
  contractLine?: string;            // Optional contract line (default: 'basic')
}
```

### Output Results

```typescript
interface TenantCreationResult {
  tenantId: string;                // Generated tenant ID
  adminUserId: string;             // Generated admin user ID
  companyId?: string;              // Generated company ID (if applicable)
  temporaryPassword: string;       // Temporary password for admin user
  emailSent: boolean;              // Whether welcome email was sent
  success: boolean;                // Overall success status
  createdAt: string;               // ISO timestamp of completion
}
```

## Error Handling & Rollback

### Automatic Rollback

The workflow includes comprehensive rollback mechanisms:

1. **User Rollback**: Removes user records and role assignments
2. **Tenant Rollback**: Removes tenant, company, and associated data
3. **Cascade Cleanup**: Handles foreign key relationships properly

### Error Types

- **ValidationError**: Invalid input data (non-retryable)
- **DuplicateError**: Tenant/user already exists (non-retryable)
- **DatabaseError**: Connection or query issues (retryable)
- **EmailError**: Email service failures (retryable)

### Retry Policy

```typescript
retry: {
  maximumAttempts: 3,
  backoffCoefficient: 2.0,
  initialInterval: '1s',
  maximumInterval: '30s',
  nonRetryableErrorTypes: ['ValidationError', 'DuplicateError']
}
```

## Monitoring & Observability

### Workflow State Queries

```typescript
// Get current workflow state
const state = await handle.query('getState');

// State includes:
// - step: Current workflow step
// - progress: Completion percentage (0-100)
// - tenantId: Created tenant ID
// - adminUserId: Created admin user ID
// - companyId: Created company ID
// - emailSent: Email delivery status
// - error: Error message (if failed)
```

### Workflow Signals

```typescript
// Cancel workflow
await handle.signal('cancel', {
  reason: 'User requested cancellation',
  cancelledBy: 'admin@example.com'
});

// Update workflow parameters
await handle.signal('update', {
  field: 'contractLine',
  value: 'enterprise'
});
```

## Testing

### E2E Tests

The system includes comprehensive end-to-end tests:

```bash
# Run all E2E tests
cd ee/temporal-workflows
npm run test:e2e

# Run specific tenant creation test
npm run test:e2e -- tenant-creation-workflow.e2e.test.ts
```

### Test Coverage

- ✅ Complete tenant creation workflow
- ✅ Database rollback on failures
- ✅ Email service integration
- ✅ Workflow state management
- ✅ Error handling and retries
- ✅ Signal and query operations

## Production Deployment

### Prerequisites

1. **Temporal Server**: Running and accessible
2. **PostgreSQL**: Alga database with proper schema
3. **Email Service**: Configured email provider (Resend, AWS SES, etc.)
4. **Worker Process**: Temporal worker running with proper activities

### Configuration

```typescript
// Worker configuration
const worker = new Worker({
  taskQueue: 'tenant-creation',
  workflowsPath: require.resolve('./workflows'),
  activitiesPath: require.resolve('./activities'),
  
  // Database connection
  connection: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  
  // Email service
  email: {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    apiKey: process.env.EMAIL_API_KEY
  }
});
```

### Health Checks

```typescript
// Basic health check workflow
const health = await client.workflow.execute('healthCheckWorkflow', {
  workflowId: 'health-check',
  taskQueue: 'tenant-creation'
});

console.log('System status:', health.status); // 'healthy'
```

## Security Considerations

### Data Protection

- All passwords are hashed using bcrypt
- Temporary passwords are cryptographically secure
- Database connections use SSL/TLS
- Email content is sanitized

### Access Control

- Workflow execution requires proper Temporal permissions
- Database operations use principle of least privilege
- Email service API keys are encrypted at rest

### Audit Trail

- All workflow executions are logged
- Database operations include audit timestamps
- Email delivery is tracked and logged

## Performance Metrics

### Typical Execution Times

- **Total Workflow**: 2-5 seconds
- **Database Operations**: 1-2 seconds
- **Email Delivery**: 1-3 seconds
- **Rollback Operations**: 0.5-1 second

### Resource Usage

- **Memory**: ~50MB per workflow execution
- **CPU**: Minimal (I/O bound operations)
- **Database**: 5-10 queries per tenant creation

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   - Check connection string and credentials
   - Verify network connectivity
   - Ensure database schema is up to date

2. **Email Delivery Failures**
   - Verify email service API key
   - Check rate limiting and quotas
   - Validate email addresses

3. **Workflow Timeouts**
   - Increase timeout values if needed
   - Check for deadlocks or slow queries
   - Monitor system resources

### Debugging

```typescript
// Enable debug logging
const client = new Client({
  address: 'localhost:7233',
  logger: new DefaultLogger('DEBUG')
});

// Query workflow history
const history = await handle.fetchHistory();
console.log('Workflow events:', history.events);
```

## Future Enhancements

### Planned Features

- **Bulk Tenant Creation**: Support for creating multiple tenants
- **Custom Email Templates**: Configurable welcome email content
- **Integration Webhooks**: Notify external systems of tenant creation
- **Advanced Analytics**: Tenant creation metrics and reporting
- **Self-Service Portal**: Allow customers to create their own tenants

### Scaling Considerations

- **Database Sharding**: For high-volume tenant creation
- **Workflow Batching**: Group operations for efficiency
- **Async Email**: Decouple email sending from workflow
- **Caching**: Cache frequently accessed data