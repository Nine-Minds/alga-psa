# Development Guide

This guide covers development workflows, best practices, and common tasks when working with the PSA platform.

## Development Environment Setup

### Prerequisites
- Docker Engine 24.0.0+
- Docker Compose v2.20.0+
- Node.js 18+
- Git
- VS Code (recommended)

### Initial Setup

1. Clone and setup:
```bash
git clone https://github.com/your-org/alga-psa.git
cd alga-psa
cp .env.example .env.development
```

2. Create development secrets:
```bash
mkdir -p secrets
# Create development secrets with dummy values
echo 'dev-password' > secrets/db_password_server
echo 'dev-password' > secrets/db_password_hocuspocus
# ... create other required secrets
chmod 600 secrets/*
```

3. Start development environment:
```bash
# For Community Edition
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up

# For Enterprise Edition
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml up
```

## Development Workflow

### 1. Code Organization

```
alga-psa/
├── server/             # Main application server
│   ├── src/           # Source code
│   ├── migrations/    # Database migrations
│   └── tests/         # Test files
├── hocuspocus/        # Real-time collaboration
├── redis/             # Redis configuration
└── setup/             # Setup and initialization
```

### 2. Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: New features
- `fix/*`: Bug fixes
- `release/*`: Release preparation

### 3. Development Cycle

1. Create feature branch:
```bash
git checkout -b feature/your-feature
```

2. Start development environment:
```bash
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up
```

3. Make changes and test
4. Commit changes:
```bash
git add .
git commit -m "feat: description"
```

5. Push and create PR:
```bash
git push origin feature/your-feature
```

## Common Development Tasks

### Database Migrations

1. Create new migration:
```bash
cd server
npm run migrate:make your_migration_name
```

2. Run migrations:
```bash
npm run migrate:latest
```

3. Rollback:
```bash
npm run migrate:rollback
```

### Testing

1. Run all tests:
```bash
npm test
```

2. Run specific tests:
```bash
npm test -- path/to/test
```

3. Watch mode:
```bash
npm test -- --watch
```

### Working with Docker

1. Rebuild specific service:
```bash
docker compose build server
```

2. View logs:
```bash
docker compose logs -f [service]
```

3. Restart service:
```bash
docker compose restart [service]
```

4. Clean up:
```bash
docker compose down -v
```

## Development Best Practices

### 1. Code Style

- Follow ESLint configuration
- Use TypeScript for type safety
- Follow existing patterns
- Document complex logic
- Write meaningful commit messages

### 2. Server Action Authentication

All server actions that need authentication and database access should use the `withAuth` wrapper:

```typescript
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

export const myAction = withAuth(async (user, { tenant }, arg1: string): Promise<Result> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'resource', 'action')) {
    throw new Error('Permission denied');
  }

  return knex('table').where({ tenant }).select('*');
});
```

**Key points:**
- `withAuth` handles authentication and sets tenant context via AsyncLocalStorage
- The wrapper provides typed `user` (IUserWithRoles) and `{ tenant }` as first two arguments
- Additional action arguments follow after the context
- Always check permissions using `hasPermission(user, resource, action)`

### 3. Testing

- Write tests for new features
- Maintain test coverage
- Use meaningful test descriptions
- Test edge cases
- Mock external dependencies

### 4. Docker

- Keep images minimal
- Use multi-stage builds
- Don't store secrets in images
- Use proper cache busting
- Tag images appropriately

### 5. Security

- Never commit secrets
- Use environment variables
- Validate user input
- Follow OWASP guidelines
- Regular dependency updates

## Debugging

### 1. Server Debugging

1. Enable debug logs:
```bash
docker compose up -f docker-compose.base.yaml -f docker-compose.ce.yaml -e DEBUG=true
```

2. Use VS Code debugger:
   - Launch configuration provided
   - Breakpoints supported
   - Variable inspection
   - Call stack tracking

### 2. Database Debugging

1. Connect to database:
```bash
docker compose exec postgres psql -U psa_user psa_db
```

2. View logs:
```bash
docker compose logs postgres
```

### 3. Event Bus and Redis Debugging

1. Redis CLI:
```bash
docker compose exec redis redis-cli
```

2. Monitor all Redis events:
```bash
docker compose exec redis redis-cli monitor
```

3. Monitor event streams:
```bash
# Monitor all events
docker compose exec redis redis-cli psubscribe "alga-psa:event:*"

# Monitor specific event type
docker compose exec redis redis-cli psubscribe "alga-psa:event:TICKET_UPDATED"
```

4. View event bus subscribers:
```bash
docker compose exec redis redis-cli pubsub channels "alga-psa:event:*"
```

5. Debug event bus configuration:
```bash
# Check Redis connection
docker compose exec redis redis-cli ping

# View event bus channels
docker compose exec redis redis-cli pubsub channels

# Check channel subscribers
docker compose exec redis redis-cli pubsub numsub channel_name
```

## Event Bus System

### 1. Configuration

The event bus system uses Redis for event streaming. Configure through environment variables:

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=alga-psa:
REDIS_EVENT_PREFIX=event:
REDIS_RECONNECT_RETRIES=10
REDIS_RECONNECT_INITIAL_DELAY=100
REDIS_RECONNECT_MAX_DELAY=3000
```

### 2. Working with Events

1. Create new event types:
```typescript
// In server/src/lib/eventBus/events.ts
export const EventTypeEnum = z.enum([
  'YOUR_NEW_EVENT',
  // ... other events
]);

export const YourEventPayloadSchema = BasePayloadSchema.extend({
  // Define your event payload schema
  // BasePayloadSchema already includes tenantId
});

// Add to EventPayloadSchemas
export const EventPayloadSchemas = {
  YOUR_NEW_EVENT: YourEventPayloadSchema,
  // ... other schemas
};
```

2. Create event subscriber:
```typescript
// In server/src/lib/eventBus/subscribers/yourSubscriber.ts
import { eventBus } from '../index';
import { YourEvent, EventType } from '../events';

async function handleYourEvent(event: YourEvent): Promise<void> {
  const { tenantId } = event.payload;
  // Handle the event
}

export async function registerYourSubscriber(): Promise<void> {
  await eventBus.subscribe(
    'YOUR_NEW_EVENT',
    handleYourEvent
  );
}
```

3. Publish events:
```typescript
import { eventBus } from 'lib/eventBus';

await eventBus.publish({
  eventType: 'YOUR_NEW_EVENT',
  payload: {
    tenantId: 'tenant-id',
    // Your event data
  },
});
```

### 3. Testing Events

1. Create event bus mocks:
```typescript
// In your test file
jest.mock('lib/eventBus', () => ({
  eventBus: {
    publish: jest.fn(),
    subscribe: jest.fn(),
  },
}));
```

2. Test event publishing:
```typescript
test('should publish event', async () => {
  const event = {
    eventType: 'YOUR_NEW_EVENT',
    payload: {
      tenantId: 'test-tenant',
      // ... other payload data
    },
  };
  
  await yourFunction();
  
  expect(eventBus.publish).toHaveBeenCalledWith(
    expect.objectContaining(event)
  );
});
```

3. Test event handling:
```typescript
test('should handle event', async () => {
  const event = {
    id: 'test-id',
    eventType: 'YOUR_NEW_EVENT',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId: 'test-tenant',
      // ... other payload data
    },
  };
  
  await handleYourEvent(event);
  
  // Assert expected behavior
});
```

## Performance Optimization

### 1. Database

- Index frequently queried fields
- Optimize complex queries
- Regular VACUUM
- Monitor query performance

### 2. Application

- Use caching effectively
- Optimize API responses
- Implement pagination
- Profile memory usage

### 3. Docker

- Optimize image sizes
- Use volume mounts
- Configure resource limits
- Monitor container stats

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Check credentials
   - Verify host/port
   - Check network connectivity

2. **Redis Connection Issues**
   - Verify password
   - Check persistence config
   - Monitor memory usage

3. **Build Issues**
   - Clear Docker cache
   - Update dependencies
   - Check Dockerfile syntax

### Debug Commands

```bash
# Check service status
docker compose ps

# View service logs
docker compose logs [service]

# Check network
docker network inspect alga-psa_default

# Container shell access
docker compose exec [service] sh
```

## Development Tools

### Recommended VS Code Extensions

- Docker
- ESLint
- Prettier
- TypeScript
- GitLens
- REST Client

### Useful Scripts

1. Development setup:
```bash
./scripts/dev-setup.sh
```

2. Test data generation:
```bash
./scripts/generate-test-data.sh
```

3. Dependency updates:
```bash
./scripts/update-deps.sh
```

## Additional Resources

- [Setup Guide](setup_guide.md)
- [Configuration Guide](configuration_guide.md)
- [API Documentation](../api/api_overview.md)
- [Testing Guide](../reference/testing-standards.md)
