import { TestContext } from '../../../../test-utils/testContext';
import { createTenant, createCompany } from '../../../../test-utils/testDataFactory';
import { v4 as uuidv4 } from 'uuid';

export interface EmailScenario {
  tenant: { tenant: string };
  company: {
    company_id: string;
    company_name: string;
    tenant: string;
  };
  contact: {
    contact_name_id: string;
    email: string;
    first_name: string;
    last_name: string;
    company_id: string;
  };
}

export interface EmailProvider {
  provider_id: string;
  tenant: string;
  provider_type: 'microsoft365' | 'gmail' | 'mailhog';
  smtp_host: string;
  smtp_port: number;
  smtp_username?: string;
  smtp_password?: string;
  is_active: boolean;
}

export class EmailTestFactory {
  private context: TestContext;
  private createdResources: {
    tenants: string[];
    companies: string[];
    contacts: string[];
    emailProviders: string[];
  };

  constructor(context: TestContext) {
    this.context = context;
    this.createdResources = {
      tenants: [],
      companies: [],
      contacts: [],
      emailProviders: []
    };
  }

  async createBasicEmailScenario(): Promise<EmailScenario> {
    // Look for existing tenants first
    let existingTenant = await this.context.db('tenants').first();
    let tenantId: string;
    
    if (existingTenant) {
      tenantId = existingTenant.tenant;
      console.log(`✅ Using existing tenant from database: ${tenantId}`);
    } else {
      // Create a new tenant if none exist
      console.log(`🏗️ No tenants found, creating new test tenant`);
      tenantId = await createTenant(this.context.db, 'E2E Test Tenant');
      this.createdResources.tenants.push(tenantId);
      console.log(`✅ Created test tenant: ${tenantId}`);
    }

    // Create company for this test
    const companyId = await createCompany(this.context.db, tenantId, 'E2E Test Company', {
      billing_cycle: 'monthly'
    });
    this.createdResources.companies.push(companyId);

    // Create contact
    const contact = await this.createContact(companyId, {
      email: 'test.customer@example.com',
      first_name: 'Test',
      last_name: 'Customer'
    }, tenantId);

    return {
      tenant: { tenant: tenantId },
      company: {
        company_id: companyId,
        company_name: 'E2E Test Company',
        tenant: tenantId
      },
      contact
    };
  }

  async createContact(companyId: string, contactData: {
    email: string;
    first_name: string;
    last_name: string;
  }, tenantId: string): Promise<EmailScenario['contact']> {
    const contactId = uuidv4();
    const now = new Date().toISOString();

    const contact = {
      tenant: tenantId,
      contact_name_id: contactId,
      company_id: companyId,
      email: contactData.email,
      full_name: `${contactData.first_name} ${contactData.last_name}`,
      is_inactive: false,
      created_at: now,
      updated_at: now
    };

    await this.context.db('contacts').insert(contact);
    this.createdResources.contacts.push(contactId);

    return {
      contact_name_id: contactId,
      email: contactData.email,
      first_name: contactData.first_name,
      last_name: contactData.last_name,
      company_id: companyId
    };
  }

  async createTestEmailProvider(tenantId: string, providerType: 'microsoft365' | 'gmail' | 'mailhog' = 'mailhog'): Promise<EmailProvider> {
    const providerId = uuidv4();
    const now = new Date().toISOString();

    const baseProvider = {
      provider_id: providerId,
      tenant: tenantId,
      provider_type: providerType,
      is_active: true,
      created_at: now,
      updated_at: now
    };

    let provider: EmailProvider;

    switch (providerType) {
      case 'mailhog':
        provider = {
          ...baseProvider,
          smtp_host: 'localhost',
          smtp_port: 1025,
          smtp_username: null,
          smtp_password: null
        } as EmailProvider;
        break;

      case 'microsoft365':
        provider = {
          ...baseProvider,
          smtp_host: 'smtp.office365.com',
          smtp_port: 587,
          smtp_username: 'test@company.com',
          smtp_password: 'test-password'
        } as EmailProvider;
        break;

      case 'gmail':
        provider = {
          ...baseProvider,
          smtp_host: 'smtp.gmail.com',
          smtp_port: 587,
          smtp_username: 'test@gmail.com',
          smtp_password: 'test-app-password'
        } as EmailProvider;
        break;
    }

    // Insert into email_providers table (assuming this table exists)
    await this.context.db('email_providers').insert(provider);
    this.createdResources.emailProviders.push(providerId);

    return provider;
  }

  async createMultiClientScenario(): Promise<{
    tenant: { tenant: string };
    companies: Array<{
      company_id: string;
      company_name: string;
      tenant: string;
      contacts: EmailScenario['contact'][];
    }>;
  }> {
    // Use existing tenant from setup container
    const existingTenant = await this.context.db('tenants').first();
    if (!existingTenant) {
      throw new Error('No tenant found in database - setup container may not have run properly');
    }
    const tenantId = existingTenant.tenant;

    const companies = [];

    // Create multiple companies with contacts
    for (let i = 1; i <= 3; i++) {
      const companyId = await createCompany(this.context.db, tenantId, `Client Company ${i}`, {
        billing_cycle: 'monthly'
      });
      this.createdResources.companies.push(companyId);

      const contacts = [];
      
      // Create 2 contacts per company
      for (let j = 1; j <= 2; j++) {
        const contact = await this.createContact(companyId, {
          email: `user${j}@client${i}.com`,
          first_name: `User${j}`,
          last_name: `Client${i}`
        }, tenantId);
        contacts.push(contact);
      }

      companies.push({
        company_id: companyId,
        company_name: `Client Company ${i}`,
        tenant: tenantId,
        contacts
      });
    }

    return {
      tenant: { tenant: tenantId },
      companies
    };
  }

  async createEmailThreadScenario(): Promise<{
    scenario: EmailScenario;
    initialTicket: {
      ticket_id: string;
      title: string;
      status: string;
    };
  }> {
    const scenario = await this.createBasicEmailScenario();
    
    // Create an initial ticket that emails can be threaded to
    const ticketId = uuidv4();
    const now = new Date().toISOString();

    const ticket = {
      ticket_id: ticketId,
      company_id: scenario.company.company_id,
      contact_name_id: scenario.contact.contact_name_id,
      tenant: scenario.tenant.tenant,
      title: 'Initial Support Ticket for Threading',
      description: 'This ticket will be used for email threading tests',
      status: 'open',
      priority: 'medium',
      created_at: now,
      updated_at: now
    };

    await this.context.db('tickets').insert(ticket);

    return {
      scenario,
      initialTicket: {
        ticket_id: ticketId,
        title: ticket.title,
        status: ticket.status
      }
    };
  }

  async createWorkflowTestData(): Promise<{
    tenant: { tenant: string };
    workflowDefinition: {
      workflow_id: string;
      name: string;
      version: string;
    };
  }> {
    // Use existing tenant from setup container
    const existingTenant = await this.context.db('tenants').first();
    if (!existingTenant) {
      throw new Error('No tenant found in database - setup container may not have run properly');
    }
    const tenantId = existingTenant.tenant;

    // Create a basic email processing workflow definition
    const workflowId = uuidv4();
    const now = new Date().toISOString();

    const workflowDefinition = {
      workflow_id: workflowId,
      tenant: tenantId,
      name: 'Email Processing Workflow',
      version: '1.0.0',
      definition: JSON.stringify({
        steps: [
          {
            id: 'email-ingestion',
            type: 'email-processor',
            config: {
              provider: 'mailhog'
            }
          },
          {
            id: 'client-matching',
            type: 'client-matcher',
            config: {
              fallback: 'manual-selection'
            }
          },
          {
            id: 'ticket-creation',
            type: 'ticket-creator',
            config: {
              default_status: 'open',
              default_priority: 'medium'
            }
          }
        ]
      }),
      is_active: true,
      created_at: now,
      updated_at: now
    };

    // Insert workflow definition (assuming workflow_definitions table exists)
    await this.context.db('workflow_definitions').insert(workflowDefinition);

    return {
      tenant: { tenant: tenantId },
      workflowDefinition: {
        workflow_id: workflowId,
        name: workflowDefinition.name,
        version: workflowDefinition.version
      }
    };
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up E2E test data...');

    try {
      // Clean up in reverse order of creation to respect foreign key constraints
      
      // Clean up email providers
      if (this.createdResources.emailProviders.length > 0) {
        await this.context.db('email_providers')
          .whereIn('provider_id', this.createdResources.emailProviders)
          .del();
      }

      // Clean up comments that reference tickets (must be done before deleting tickets)
      if (this.createdResources.contacts.length > 0) {
        const tickets = await this.context.db('tickets')
          .whereIn('contact_name_id', this.createdResources.contacts)
          .select('ticket_id');
        
        if (tickets.length > 0) {
          const ticketIds = tickets.map(t => t.ticket_id);
          await this.context.db('comments')
            .whereIn('ticket_id', ticketIds)
            .del();
        }
      }

      // Clean up tickets that reference contacts (must be done before deleting contacts)
      if (this.createdResources.contacts.length > 0) {
        await this.context.db('tickets')
          .whereIn('contact_name_id', this.createdResources.contacts)
          .del();
      }

      // Clean up contacts
      if (this.createdResources.contacts.length > 0) {
        await this.context.db('contacts')
          .whereIn('contact_name_id', this.createdResources.contacts)
          .del();
      }

      // Clean up companies
      if (this.createdResources.companies.length > 0) {
        await this.context.db('companies')
          .whereIn('company_id', this.createdResources.companies)
          .del();
      }

      // Clean up tenants
      if (this.createdResources.tenants.length > 0) {
        await this.context.db('tenants')
          .whereIn('tenant', this.createdResources.tenants)
          .del();
      }

      // Reset tracking arrays
      this.createdResources = {
        tenants: [],
        companies: [],
        contacts: [],
        emailProviders: []
      };

      console.log('✅ E2E test data cleanup completed');
    } catch (error) {
      console.error('❌ Error during E2E test data cleanup:', error);
      throw error;
    }
  }

  async createTestTicket(scenario: EmailScenario, ticketData: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
  }): Promise<{ ticket_id: string }> {
    const ticketId = uuidv4();
    const now = new Date().toISOString();

    const ticket = {
      ticket_id: ticketId,
      company_id: scenario.company.company_id,
      contact_name_id: scenario.contact.contact_name_id,
      tenant: scenario.tenant.tenant,
      title: ticketData.title,
      description: ticketData.description || '',
      status: ticketData.status || 'open',
      priority: ticketData.priority || 'medium',
      created_at: now,
      updated_at: now
    };

    await this.context.db('tickets').insert(ticket);

    return { ticket_id: ticketId };
  }

  async createEmailMessage(ticketId: string, messageData: {
    from_email: string;
    to_email: string;
    subject: string;
    body: string;
    message_id?: string;
    in_reply_to?: string;
  }): Promise<{ message_id: string }> {
    const messageId = messageData.message_id || uuidv4();
    const now = new Date().toISOString();

    const emailMessage = {
      message_id: messageId,
      ticket_id: ticketId,
      from_email: messageData.from_email,
      to_email: messageData.to_email,
      subject: messageData.subject,
      body: messageData.body,
      in_reply_to: messageData.in_reply_to,
      created_at: now,
      updated_at: now
    };

    await this.context.db('email_messages').insert(emailMessage);

    return { message_id: messageId };
  }
}