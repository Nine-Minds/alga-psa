# Temporal Workflows for Tenant Management

This project implements Temporal workflows for enterprise tenant creation and management in the Alga PSA system.

## Overview

The Temporal workflow system provides reliable, scalable, and observable tenant provisioning with the following capabilities:

- **Tenant Creation**: Automated tenant database setup and configuration
- **User Management**: Admin user creation with proper role assignment
- **Data Setup**: Initial configuration of billing plans, statuses, and preferences
- **Error Handling**: Comprehensive rollback mechanisms for failed operations
- **Monitoring**: Health checks and workflow state tracking

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client API    │    │  Temporal       │    │   Activities    │
│                 │───▶│  Workflows      │───▶│                 │
│ - REST endpoints│    │                 │    │ - Tenant DB ops │
│ - Validation    │    │ - Orchestration │    │ - User creation │
│ - Auth          │    │ - Error handling│    │ - Data setup    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Database      │
                       │                 │
                       │ - PostgreSQL    │
                       │ - Tenant data   │
                       │ - User accounts │
                       └─────────────────┘
```

## Project Structure

```
ee/temporal-workflows/
├── src/
│   ├── workflows/              # Temporal workflow definitions
│   │   ├── tenant-creation-workflow.ts
│   │   └── index.ts
│   ├── activities/             # Activity implementations
│   │   ├── tenant-activities.ts
│   │   ├── user-activities.ts
│   │   └── index.ts
│   ├── types/                  # TypeScript type definitions
│   │   └── workflow-types.ts
│   ├── worker.ts              # Temporal worker process
│   └── client.ts              # Temporal client library
├── k8s/                       # Kubernetes deployment manifests
│   └── deployment.yaml
├── scripts/                   # Deployment and utility scripts
│   └── deploy.sh
├── Dockerfile                 # Container image definition
├── docker-compose.yaml        # Local development setup
└── README.md                  # This file
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Kubernetes cluster with Temporal installed
- PostgreSQL database
- Access to Temporal cluster at `temporal-frontend.temporal.svc.cluster.local:7233`

### Local Development

1. **Install dependencies**:
   ```bash
   cd ee/temporal-workflows
   npm install
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your database and Temporal configuration
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Start the worker**:
   ```bash
   npm run start:worker
   ```

5. **Run a test workflow** (in another terminal):
   ```bash
   npm run start:client
   ```

### Docker Development

1. **Start services with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

2. **View worker logs**:
   ```bash
   docker-compose logs -f temporal-worker
   ```

3. **Run example client**:
   ```bash
   docker-compose run --rm temporal-client-example
   ```

## Usage

### Starting a Tenant Creation Workflow

```typescript
import { TenantWorkflowClient } from './src/client';

const client = await TenantWorkflowClient.create();

const { workflowId, result } = await client.startTenantCreation({
  tenantName: 'Acme Corporation',
  adminUser: {
    firstName: 'John',
    lastName: 'Admin',
    email: 'admin@acme.com',
    password: 'securePassword123!'
  },
  companyName: 'Acme Corp',
  billingPlan: 'Enterprise'
});

console.log('Workflow started:', workflowId);

const finalResult = await result;
console.log('Tenant created:', finalResult);
```

### Monitoring Workflow State

```typescript
// Get current workflow state
const state = await client.getTenantCreationState(workflowId);
console.log('Workflow progress:', state.progress + '%');
console.log('Current step:', state.step);

// Cancel a workflow if needed
await client.cancelTenantCreation(workflowId, 'User requested cancellation', 'admin@example.com');
```

### Health Checking

```typescript
// Verify Temporal connectivity
const health = await client.healthCheck();
console.log('System status:', health.status);
```

## Deployment

### Kubernetes Deployment

1. **Build and deploy**:
   ```bash
   ./scripts/deploy.sh deploy -t v1.0.0 -r your-registry.com
   ```

2. **Check status**:
   ```bash
   ./scripts/deploy.sh status
   ```

3. **View logs**:
   ```bash
   ./scripts/deploy.sh logs
   ```

4. **Rollback if needed**:
   ```bash
   ./scripts/deploy.sh rollback
   ```

### Configuration

The worker uses environment variables for configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `TEMPORAL_ADDRESS` | Temporal server address | `temporal-frontend.temporal.svc.cluster.local:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `TEMPORAL_TASK_QUEUE` | Task queue name | `tenant-workflows` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `ADMIN_DATABASE_URL` | Admin database connection | Required |
| `LOG_LEVEL` | Logging level | `info` |
| `MAX_CONCURRENT_ACTIVITIES` | Max concurrent activities | `10` |
| `MAX_CONCURRENT_WORKFLOWS` | Max concurrent workflows | `10` |

## Workflow Details

### Tenant Creation Workflow

The main workflow (`tenantCreationWorkflow`) performs these steps:

1. **Validate Input**: Check tenant name and admin user details
2. **Create Tenant**: Insert tenant record and optional default company
3. **Create Admin User**: Set up admin user with proper authentication
4. **Setup Initial Data**: Configure roles, statuses, billing, and preferences
5. **Complete**: Return tenant and user IDs

### Error Handling

The workflow includes comprehensive error handling:

- **Validation Errors**: Input validation with clear error messages
- **Database Errors**: Transaction rollback and data cleanup
- **Timeout Handling**: Configurable timeouts for each activity
- **Retry Logic**: Automatic retries with exponential backoff
- **Rollback Operations**: Clean removal of partially created data

### Signals and Queries

- **Cancel Signal**: Gracefully cancel workflow execution
- **Update Signal**: Modify workflow parameters during execution
- **State Query**: Get current workflow progress and status

## Integration

### Database Integration

The workflows integrate with the existing Alga PSA database schema:

- Uses `@shared/db` utilities for database connections
- Follows CitusDB compatibility requirements
- Maintains tenant isolation and security policies
- Leverages existing action patterns from `server/src/lib/actions/`

### Security

- Passwords are hashed using the same algorithm as the main application
- All database operations respect tenant boundaries
- User permissions are properly configured
- Admin users get full system access within their tenant

### Monitoring

- Structured logging with Winston
- Health check endpoints for Kubernetes
- Temporal Web UI integration for workflow visualization
- Metrics and alerting support

## Testing

### Unit Testing

```bash
npm test
```

### Integration Testing

```bash
npm run test:integration
```

### Load Testing

The system supports horizontal scaling through:
- Multiple worker instances
- Configurable concurrency limits
- Kubernetes HPA for automatic scaling

## Troubleshooting

### Common Issues

1. **Connection Errors**:
   - Verify Temporal server address and connectivity
   - Check network policies and service discovery

2. **Database Errors**:
   - Ensure database credentials are correct
   - Verify tenant isolation is properly configured

3. **Workflow Failures**:
   - Check Temporal Web UI for detailed execution history
   - Review worker logs for activity failures

### Debugging

1. **Enable debug logging**:
   ```bash
   export LOG_LEVEL=debug
   ```

2. **Check Temporal Web UI**: https://temporal.nineminds.com

3. **View worker metrics**:
   ```bash
   kubectl logs -l app=temporal-workflows-worker -n default
   ```

## Development Guidelines

### Adding New Workflows

1. Create workflow definition in `src/workflows/`
2. Implement required activities in `src/activities/`
3. Add type definitions in `src/types/`
4. Update client interface if needed
5. Add tests and documentation

### Database Operations

- Always use transaction wrappers from `@shared/db`
- Include tenant filtering in all queries
- Follow CitusDB compatibility patterns
- Implement proper rollback logic

### Error Handling

- Use specific error types for different failure modes
- Implement idempotent operations where possible
- Provide detailed error messages and context
- Log errors with appropriate severity levels

## Contributing

1. Follow existing code patterns and TypeScript conventions
2. Add tests for new functionality
3. Update documentation for API changes
4. Ensure CitusDB compatibility for database operations
5. Test deployment with the provided scripts

## License

This is part of the Alga PSA enterprise edition. See the main project license for details.