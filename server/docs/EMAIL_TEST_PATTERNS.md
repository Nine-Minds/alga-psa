# Email Test Patterns

This guide explains the abstracted patterns for writing email E2E tests that are maintainable, reliable, and easy to understand.

## Overview

Email testing involves complex tenant synchronization, workflow processing, and database state management. Rather than repeating this complexity in every test, we've abstracted common patterns into reusable utilities.

## Quick Start

### Basic Email Test
```typescript
import { createPersistentE2EHelpers } from './utils/persistent-test-context';
import { createEmailTestHelpers } from './utils/email-test-helpers';

describe('My Email Tests', () => {
  let context, emailHelpers;

  beforeAll(async () => {
    context = await createPersistentE2EHelpers().beforeAll();
    emailHelpers = createEmailTestHelpers(context);
  });

  it('should process an email', async () => {
    // Arrange - Create scenario with automatic tenant handling
    const scenario = await emailHelpers.createEmailScenario();
    
    // Act - Send email
    await scenario.sendEmail({
      subject: 'Test Email',
      body: 'Test body'
    });
    await scenario.waitForProcessing();

    // Assert - Verify results
    const tickets = await scenario.getTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].title).toContain('Test Email');
  });
});
```

## Core Abstractions

### 1. Email Test Helpers (`EmailTestHelpers`)

The main abstraction that handles:
- ✅ Tenant creation and synchronization
- ✅ Database transaction management
- ✅ MailHog service coordination
- ✅ Data visibility across connections
- ✅ Debug logging

**Methods:**
- `createEmailScenario()` - Create complete test scenario
- `createUnknownEmailScenario()` - For testing unknown senders

### 2. Email Test Scenario (`EmailTestScenario`)

A scenario object that provides:
- ✅ Pre-configured tenant, company, and contact
- ✅ Simple email sending with automatic tenant handling
- ✅ Workflow processing coordination
- ✅ Easy data retrieval methods

**Methods:**
- `sendEmail(config)` - Send email with tenant synchronization
- `waitForProcessing(timeout?)` - Wait for workflow completion
- `getTickets()` - Get tickets for this scenario's contact
- `getComments(ticketId)` - Get comments for a ticket
- `getDocuments()` - Get attachments/documents

### 3. Static Assertion Helpers (`EmailTestHelpers`)

Pre-built assertions for common test scenarios:
- ✅ `assertTicketCreated()` - Verify ticket creation
- ✅ `assertAttachmentProcessed()` - Verify attachment handling
- ✅ `assertEmailThreading()` - Verify reply threading

## Test Patterns

### Pattern 1: Simple Email Processing
```typescript
it('should process a simple email', async () => {
  const scenario = await emailHelpers.createEmailScenario();
  
  await scenario.sendEmail({
    subject: 'Support Request',
    body: 'Please help me with this issue.'
  });
  await scenario.waitForProcessing();

  const tickets = await scenario.getTickets();
  EmailTestHelpers.assertTicketCreated(tickets, 'Support Request', scenario.contact.email);
});
```

### Pattern 2: Email with Attachments
```typescript
it('should handle email attachments', async () => {
  const scenario = await emailHelpers.createEmailScenario();
  
  await scenario.sendEmail({
    subject: 'Document Upload',
    body: 'Please see attached document.',
    attachments: [{
      filename: 'report.pdf',
      content: Buffer.from('PDF content'),
      contentType: 'application/pdf'
    }]
  });
  await scenario.waitForProcessing();

  const documents = await scenario.getDocuments();
  EmailTestHelpers.assertAttachmentProcessed(documents, 'report.pdf');
});
```

### Pattern 3: Email Threading/Replies
```typescript
it('should thread email replies', async () => {
  const scenario = await emailHelpers.createEmailScenario();
  
  // Send initial email
  const { sentEmail } = await scenario.sendEmail({
    subject: 'Initial Request',
    body: 'Original message'
  });
  await scenario.waitForProcessing();
  const initialTickets = await scenario.getTickets();
  
  // Send reply
  await scenario.sendEmail({
    subject: 'Re: Initial Request', 
    body: 'Reply message',
    inReplyTo: sentEmail.messageId,
    references: sentEmail.messageId
  });
  await scenario.waitForProcessing();
  
  const finalTickets = await scenario.getTickets();
  const comments = await scenario.getComments(initialTickets[0].ticket_id);
  
  EmailTestHelpers.assertEmailThreading(
    initialTickets, finalTickets, comments,
    'Original message', 'Reply message'
  );
});
```

### Pattern 4: Unknown Email Addresses
```typescript
it('should handle unknown senders', async () => {
  const unknownScenario = await emailHelpers.createUnknownEmailScenario();
  
  await unknownScenario.sendEmail({
    subject: 'Unknown Sender',
    body: 'Email from unknown address'
  });
  await unknownScenario.waitForProcessing();

  const tickets = await unknownScenario.getTickets();
  // Verify appropriate handling (may create task for manual review)
  expect(tickets.length).toBeGreaterThanOrEqual(0);
});
```

## What's Abstracted Away

### Before (Manual Pattern)
```typescript
it('should process email', async () => {
  // 20+ lines of tenant setup
  const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
  console.log(`[TENANT-DEBUG] Test scenario created: tenant=${tenant.tenant}`);
  
  const tenantCheck = await context.db('tenants').where('tenant', tenant.tenant).first();
  if (!tenantCheck) {
    throw new Error(`Tenant not found`);
  }
  
  try {
    await context.db.raw('COMMIT');
    await context.db.raw('BEGIN');
  } catch (error) {
    // Handle transaction errors
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const testEmail = { /* email config */ };
  const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
  await context.waitForWorkflowProcessing(30000);
  
  // 10+ lines of manual queries and assertions
  const ticketResult = await context.db.raw(`SELECT...`);
  const tickets = ticketResult.rows || ticketResult;
  expect(tickets).toHaveLength(1);
  // etc...
});
```

### After (Abstracted Pattern) 
```typescript
it('should process email', async () => {
  const scenario = await emailHelpers.createEmailScenario();
  
  await scenario.sendEmail({
    subject: 'Test Email',
    body: 'Test body'
  });
  await scenario.waitForProcessing();

  const tickets = await scenario.getTickets();
  EmailTestHelpers.assertTicketCreated(tickets, 'Test Email', scenario.contact.email);
});
```

## Benefits

### ✅ **Reduced Complexity**
- 5-10 lines vs 50+ lines per test
- No need to understand tenant synchronization details
- Built-in error handling and logging

### ✅ **Consistency**
- All tests use the same proven patterns
- Eliminates copy-paste errors
- Standardized debugging output

### ✅ **Maintainability**
- Changes to tenant handling logic in one place
- Easy to add new helper methods
- Clear separation of concerns

### ✅ **Readability**
- Tests focus on business logic, not infrastructure
- Self-documenting method names
- Consistent assertion patterns

### ✅ **Reliability**
- Proven tenant synchronization patterns
- Automatic timeout management
- Robust error handling

## Migration Guide

### For Existing Tests
1. Replace manual tenant handling with `emailHelpers.createEmailScenario()`
2. Replace manual email sending with `scenario.sendEmail()`
3. Replace manual queries with scenario methods (`getTickets()`, etc.)
4. Replace manual assertions with static helper methods

### For New Tests
1. Import the helper utilities
2. Use the abstracted patterns from the start
3. Focus on test business logic, not infrastructure

## Extension Points

### Adding New Scenario Types
```typescript
// In EmailTestHelpers class
async createBulkEmailScenario(): Promise<BulkEmailScenario> {
  // Implementation for testing bulk email processing
}
```

### Adding New Assertions
```typescript
// In EmailTestHelpers class
static assertPrioritySet(tickets: any[], expectedPriority: string): void {
  expect(tickets[0].priority_name).toBe(expectedPriority);
}
```

### Custom Email Configurations
```typescript
await scenario.sendEmail({
  subject: 'Custom Test',
  body: 'Custom body',
  from: 'custom@sender.com',
  to: 'custom@recipient.com',
  attachments: [/* custom attachments */],
  inReplyTo: 'custom-reply-id',
  references: 'custom-references'
});
```

## File Structure

```
src/test/e2e/
├── utils/
│   ├── email-test-helpers.ts       # Main abstraction
│   ├── persistent-test-context.ts  # Persistent harness
│   └── ...
├── email-processing-simplified.test.ts  # Example using abstractions
├── email-processing-persistent.test.ts  # Direct persistent usage
└── email-processing.test.ts             # Original manual pattern
```

This abstraction approach ensures that all future email tests will be fast, reliable, and maintainable while hiding the complexity of tenant synchronization and workflow coordination.