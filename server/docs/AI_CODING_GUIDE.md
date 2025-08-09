# AI Coding Assistant Guide

This document provides guidance for AI coding assistants working with the Alga PSA codebase.

## Prerequisites

- **Node.js 20.0.0 or higher** is required for this project
- Understanding of TypeScript, Next.js 14, and PostgreSQL
- Familiarity with REST API design patterns

## Key Architectural Patterns

### 1. V2 Controller Pattern
All new APIs should use the V2 controller pattern located in `/src/lib/api/controllers/`. This pattern:
- Handles authentication inline to avoid circular dependencies
- Uses Zod schemas for validation
- Implements consistent error handling
- Supports tenant isolation

Example structure:
```typescript
export class ApiXxxControllerV2 extends ApiBaseControllerV2 {
  constructor() {
    super(xxxService, {
      resource: 'xxx',
      createSchema: createXxxSchema,
      updateSchema: updateXxxSchema,
      querySchema: xxxListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
  }
}
```

### 2. Service Layer Pattern
Business logic should be in service files located in `/src/lib/services/`:
- Keep controllers thin
- Services handle database operations
- Use transactions for data consistency
- Implement proper error handling

### 3. Database Patterns
- Use Knex.js for database queries
- Always include tenant isolation (`tenant_id`)
- Use migrations for schema changes
- Follow naming conventions (snake_case for DB, camelCase for JS)

### 4. Testing Requirements
All new features must include:
- E2E tests in `/src/test/e2e/`
- Test factories for data generation
- Both positive and negative test cases
- Authentication and authorization tests

## Common Tasks

### Adding a New API Endpoint
1. Create the V2 controller in `/src/lib/api/controllers/`
2. Define Zod schemas in `/src/lib/schemas/`
3. Update route files in `/src/app/api/v1/`
4. Write E2E tests
5. Update documentation

### Modifying Database Schema
1. Create a migration file: `npm run migrate:make <name>`
2. Write up and down migrations
3. Run migrations: `npm run migrate`
4. Update TypeScript interfaces
5. Update affected services and controllers

### Working with Authentication
- REST APIs use API keys (X-API-KEY header)
- Web interface uses session-based auth
- Always verify tenant context
- Check permissions before operations

## Code Quality Standards

### TypeScript
- Use strict mode
- Define proper interfaces
- Avoid `any` types
- Use type guards where needed

### Error Handling
- Use consistent error classes
- Return appropriate HTTP status codes
- Include helpful error messages
- Log errors appropriately

### Performance
- Use database indexes appropriately
- Implement pagination for list endpoints
- Cache frequently accessed data
- Optimize N+1 queries

## Important Files and Directories

- `/src/lib/api/controllers/` - V2 API controllers
- `/src/lib/services/` - Business logic services
- `/src/lib/schemas/` - Zod validation schemas
- `/src/app/api/v1/` - API route definitions
- `/src/test/e2e/` - End-to-end tests
- `/migrations/` - Database migrations
- `/docs/` - Project documentation

## Debugging Tips

1. Check logs in `/logs/` directory
2. Use `npm run test:watch` for TDD
3. Verify tenant context in all queries
4. Check API key permissions
5. Review error responses for clues

## Common Pitfalls to Avoid

1. **Circular Dependencies**: Use inline authentication in V2 controllers
2. **Missing Tenant Context**: Always include tenant_id in queries
3. **Inadequate Validation**: Use Zod schemas for all inputs
4. **Poor Error Messages**: Provide clear, actionable error messages
5. **Skipping Tests**: Always write E2E tests for new features

## Getting Help

- Review existing V2 controllers for examples
- Check `/docs/api-migration-summary.md` for patterns
- Look at test files for usage examples
- Follow established conventions in the codebase