# Temporal Workflows for Tenant Management

This project implements Temporal workflows for enterprise tenant creation and management in the Alga PSA system.

## Overview

The Temporal workflow system provides reliable, scalable, and observable tenant provisioning with the following capabilities:

- **Tenant Creation**: Automated tenant database setup and configuration
- **User Management**: Admin user creation with proper role assignment
- **Data Setup**: Initial configuration of contract lines, statuses, and preferences
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

## Quick Start - Local Development

### Prerequisites

- Node.js 20+
- Temporal CLI (`brew install temporal` or download from https://temporal.io/downloads)
- Local PostgreSQL database running (or use the project's Docker containers)

### Step-by-Step Local Development Setup

#### 1. Start Local Database (if not already running)
```bash
# From project root (~/alga-psa)
docker ps | grep postgres  # Check if already running

# If not running, start the database containers:
docker-compose up -d postgres pgbouncer
```

#### 2. Start Temporal Dev Server
```bash
# In a dedicated terminal, keep this running:
temporal server start-dev

# This starts:
# - Temporal server on port 7233
# - Web UI on port 8233 (http://localhost:8233)
# - Uses SQLite (no external dependencies needed!)
```

#### 3. Configure Environment
```bash
cd ee/temporal-workflows

# Create .env file with the following content:
cat > .env << 'EOF'
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME_SERVER=server
DB_USER_SERVER=postgres
DB_PASSWORD_SERVER=postpass123
DB_USER_ADMIN=postgres
DB_PASSWORD_ADMIN=postpass123

# Temporal Configuration (using local dev server)
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=tenant-workflows

# Auth Key (get from secrets/alga_auth_key)
ALGA_AUTH_KEY=your-auth-key-here

# Logging
LOG_LEVEL=info

# Worker Configuration
MAX_CONCURRENT_ACTIVITIES=10
MAX_CONCURRENT_WORKFLOWS=10

# Health Check
ENABLE_HEALTH_CHECK=true
HEALTH_CHECK_PORT=8080

# Environment
NODE_ENV=development
EOF

# Set the actual auth key
echo "ALGA_AUTH_KEY=$(cat ../../secrets/alga_auth_key 2>/dev/null || echo 'set-your-key')" >> .env
```

#### 4. Install Dependencies and Build
```bash
npm install
npm run build
```

#### 5. Start the Worker
```bash
# Terminal 3: Start the worker
npm run start:worker
```

#### 6. Test the Worker
```bash
# Terminal 4: Run test client
npm run start:client
```

### Quick Commands Reference

```bash
# All commands from ee/temporal-workflows directory

# Start everything (assuming port-forwarding is active):
npm run build && npm run start:worker

# Run tests:
npm test                    # Unit tests
npm run test:integration    # Integration tests

# Watch mode for development:
npm run dev                 # If available

# Check worker logs:
docker-compose logs -f temporal-worker  # If using Docker

# View Temporal Web UI (after port-forwarding):
open http://localhost:8088
```

### Troubleshooting

#### Database Connection Issues
```bash
# Verify PostgreSQL is running:
docker ps | grep postgres

# Test connection:
PGPASSWORD=postpass123 psql -h localhost -p 5432 -U postgres -d server -c "SELECT 1"

# If connection fails, check Docker containers:
docker-compose ps
docker-compose up -d postgres pgbouncer
```

#### Temporal Connection Issues
```bash
# Verify port-forwarding is active:
lsof -i :7233

# Check Temporal service in cluster:
kubectl get svc -n temporal | grep frontend

# Restart port-forwarding:
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
```

#### Missing Environment Variables
```bash
# Check required variables are set:
grep -E "DB_|TEMPORAL_|ALGA_AUTH_KEY" .env

# Get auth key from secrets:
cat ../../secrets/alga_auth_key
```

#### Build Errors
```bash
# Clean and rebuild:
rm -rf dist node_modules
npm install
npm run build
```

### Alternative: Docker Compose Development

If you prefer to use Docker Compose for everything:

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
  contractLine: 'Enterprise'
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
| `STRIPE_SECRET_KEY` | Stripe API secret key for billing integration | Required for Stripe |
| `MASTER_BILLING_TENANT_ID` | Nine Minds billing tenant UUID | Required for Stripe |
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