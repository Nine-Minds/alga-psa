# E2E Email Testing - Quick Reference

## 🚀 Getting Started

### Run Tests
```bash
cd server
npm run test:e2e:email     # Email processing tests
npm run test:e2e           # All E2E tests
```

### Debug Services
```bash
cd /Users/robertisaacs/alga-psa
docker-compose -f docker-compose.e2e-with-worker.yaml up -d
```

## 🔧 Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| MailHog Web | http://localhost:8025 | View captured emails |
| MailHog SMTP | localhost:1025 | Send test emails |
| Workflow Worker | http://localhost:4001/health | Health check |
| PostgreSQL | localhost:5433 | Test database |
| Redis | localhost:6380 | Test streams |
| WireMock | http://localhost:8080 | Mock webhooks |

## 📝 Basic Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { E2ETestContext } from './utils/e2e-test-context';

describe('My Email Tests', () => {
  const testHelpers = E2ETestContext.createE2EHelpers();
  let context: E2ETestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({ testMode: 'e2e' });
  });

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  it('should process email', async () => {
    // Create test scenario
    const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
    
    // Send and capture email
    const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail({
      from: contact.email,
      to: 'support@company.com',
      subject: 'Test Email',
      body: 'Test content'
    });
    
    // Wait for processing
    await context.waitForWorkflowProcessing();
    
    // Validate results
    const tickets = await context.db.raw('SELECT * FROM tickets WHERE...');
    expect(tickets).toHaveLength(1);
  });
});
```

## 🛠 Common Operations

### Create Test Data
```typescript
// Basic scenario (tenant + company + contact)
const scenario = await context.emailTestFactory.createBasicEmailScenario();

// Multi-client scenario
const multiClient = await context.emailTestFactory.createMultiClientScenario();

// Custom contact
const contact = await context.emailTestFactory.createContact(companyId, {
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User'
});
```

### Send Emails
```typescript
// Simple send and capture
const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail({
  from: 'sender@example.com',
  to: 'support@company.com',
  subject: 'Test Subject',
  body: 'Test body'
});

// With attachments
const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail({
  from: 'sender@example.com',
  to: 'support@company.com',
  subject: 'Test with Attachment',
  body: 'Test body',
  attachments: [{
    filename: 'test.pdf',
    content: Buffer.from('PDF content'),
    contentType: 'application/pdf'
  }]
});

// Reply email (threading)
const replyEmail = await context.mailhogClient.sendEmail({
  from: 'sender@example.com',
  to: 'support@company.com',
  subject: 'Re: Original Subject',
  body: 'Reply content',
  inReplyTo: originalEmail.messageId,
  references: originalEmail.messageId
});
```

### Validate Results
```typescript
// Check tickets created
const tickets = await context.db.raw(`
  SELECT t.*, c.email as contact_email 
  FROM tickets t 
  JOIN contacts c ON t.contact_name_id = c.contact_name_id
  WHERE c.email = ?
`, [contact.email]);

// Check workflow events
const events = await context.db.raw(`
  SELECT * FROM workflow_events 
  WHERE event_type = 'email_client_selection_required'
`);

// Check email messages
const messages = await context.db.raw(`
  SELECT * FROM email_messages 
  WHERE ticket_id = ?
`, [ticketId]);

// Check attachments
const attachments = await context.db.raw(`
  SELECT * FROM attachments 
  WHERE ticket_id = ?
`, [ticketId]);
```

## 🐛 Debugging

### Check Service Status
```typescript
const status = await context.getServicesStatus();
console.log('Services:', status);
```

### View Service Logs
```typescript
const logs = await context.dockerServices.getContainerLogs('workflow-worker-test');
console.log('Worker logs:', logs);
```

### Manual Email Inspection
```bash
# View MailHog interface
open http://localhost:8025

# Check MailHog API
curl http://localhost:8025/api/v1/messages | jq
```

### Database Queries
```typescript
// Check test data
const tenants = await context.db('tenants').select();
const companies = await context.db('companies').select();
const contacts = await context.db('contacts').select();

console.log('Test data:', { tenants, companies, contacts });
```

## ⚠️ Troubleshooting

### Services Won't Start
```bash
# Check what's running
docker ps

# View all logs
docker-compose -f docker-compose.e2e-with-worker.yaml logs

# Restart specific service
docker-compose -f docker-compose.e2e-with-worker.yaml restart workflow-worker-test

# Full restart
docker-compose -f docker-compose.e2e-with-worker.yaml down
docker-compose -f docker-compose.e2e-with-worker.yaml up -d
```

### Tests Timeout
```typescript
// Increase timeouts
await context.waitForWorkflowProcessing(60000); // 60 seconds

// Check if services are healthy
const healthy = await context.mailhogClient.isHealthy();
if (!healthy) {
  throw new Error('MailHog not healthy');
}
```

### Email Not Captured
1. Check MailHog is running: http://localhost:8025
2. Verify email was sent: Check MailHog messages API
3. Check SMTP connection: Port 1025 should be accessible

### Database Issues
```typescript
// Test database connection
const version = await context.db.raw('SELECT version()');
console.log('Database:', version);

// Check if tables exist
const tables = await context.db.raw(`
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public'
`);
console.log('Tables:', tables);
```

## 📊 Test Patterns

### Email Threading Test
```typescript
it('should thread email replies', async () => {
  const scenario = await context.emailTestFactory.createBasicEmailScenario();
  
  // Send initial email
  const initial = await context.sendAndCaptureEmail({
    from: scenario.contact.email,
    to: 'support@company.com',
    subject: 'Initial Request',
    body: 'Initial content'
  });
  
  await context.waitForWorkflowProcessing();
  
  // Send reply
  const reply = await context.mailhogClient.sendEmail({
    from: scenario.contact.email,
    to: 'support@company.com',
    subject: 'Re: Initial Request',
    body: 'Reply content',
    inReplyTo: initial.sentEmail.messageId,
    references: initial.sentEmail.messageId
  });
  
  await context.waitForWorkflowProcessing();
  
  // Should have same ticket
  const tickets = await context.db.raw(/* query tickets */);
  expect(tickets).toHaveLength(1);
  
  // Should have multiple messages
  const messages = await context.db.raw(/* query messages */);
  expect(messages).toHaveLength(2);
});
```

### Unknown Sender Test
```typescript
it('should handle unknown senders', async () => {
  await context.sendAndCaptureEmail({
    from: 'unknown@example.com',
    to: 'support@company.com',
    subject: 'Unknown Sender',
    body: 'From unknown sender'
  });
  
  await context.waitForWorkflowProcessing();
  
  // Should create manual workflow event
  const events = await context.db.raw(`
    SELECT * FROM workflow_events 
    WHERE event_type = 'email_client_selection_required'
  `);
  
  expect(events).toHaveLength(1);
  expect(events[0].status).toBe('pending');
});
```

### Multi-Client Test
```typescript
it('should handle multiple clients', async () => {
  const { companies } = await context.emailTestFactory.createMultiClientScenario();
  
  // Send emails from different clients
  for (const company of companies) {
    for (const contact of company.contacts) {
      await context.sendAndCaptureEmail({
        from: contact.email,
        to: 'support@company.com',
        subject: `Request from ${company.company_name}`,
        body: 'Client-specific request'
      });
    }
  }
  
  await context.waitForWorkflowProcessing();
  
  // Should create tickets for each client
  const tickets = await context.db.raw(/* query all tickets */);
  expect(tickets).toHaveLength(companies.length * 2); // 2 contacts per company
});
```

## 🔗 Related Documentation

- [Implementation Guide](./implementation-guide.md) - How the email processing works
- [Workflow Guide](./workflow-guide.md) - Workflow engine details
- [API Guide](./api-guide.md) - API endpoints and usage
- [Integration Notes](./INTEGRATION_NOTES.md) - Integration considerations