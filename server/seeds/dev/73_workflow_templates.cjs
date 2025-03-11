/**
 * Seed file for workflow templates
 */
exports.seed = async function(knex) {
  // Get the tenant from the tenant table
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) {
    console.log('No tenant found, skipping workflow templates seed');
    return;
  }

  // Check if templates already exist
  const existingTemplates = await knex('workflow_templates').count('template_id as count').first();
  
  // Skip seeding if templates already exist
  if (existingTemplates.count > 0) {
    console.log('Workflow templates already exist, skipping seed');
    return;
  }
  
  // Create template categories
  const categories = [
    {
      name: 'Billing',
      description: 'Templates for automating billing processes',
      display_order: 1
    },
    {
      name: 'Support',
      description: 'Templates for automating support processes',
      display_order: 2
    },
    {
      name: 'Assets',
      description: 'Templates for automating asset management',
      display_order: 3
    },
    {
      name: 'Approvals',
      description: 'Templates for automating approval workflows',
      display_order: 4
    }
  ];
  
  // Insert categories
  for (const category of categories) {
    await knex('workflow_template_categories').insert({
      tenant_id: tenant,
      ...category,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  
  // Get category IDs
  const categoryMap = {};
  const categoryRecords = await knex('workflow_template_categories').select('category_id', 'name');
  categoryRecords.forEach(record => {
    categoryMap[record.name] = record.category_id;
  });
  
  // Template definitions
  const templates = [
    {
      name: 'Auto-Invoice Generation',
      description: 'Automatically generate invoices based on time entries',
      category: 'Billing',
      tags: ['invoice', 'billing', 'automation'],
      definition: {
        metadata: {
          name: 'AutoInvoiceGeneration',
          description: 'Automatically generate invoices based on time entries',
          version: '1.0.0',
          author: 'System',
          tags: ['invoice', 'billing', 'automation']
        },
        executeFn: `/**
 * Auto-Invoice Generation Workflow
 * Automatically generates invoices based on time entries
 *
 * @param context The workflow context provided by the runtime
 */
async function autoInvoiceWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('collecting_time_entries');
  logger.info('Starting auto-invoice generation workflow');
  
  // Wait for billing cycle event
  const billingEvent = await events.waitFor('BillingCycleComplete');
  logger.info('Received billing cycle event', billingEvent.payload);
  
  // Extract client ID from event
  const { clientId, billingPeriodStart, billingPeriodEnd } = billingEvent.payload;
  
  // Update state
  context.setState('processing_time_entries');
  
  try {
    // Get time entries for the client in the billing period
    const timeEntries = await actions.getTimeEntries({
      clientId,
      startDate: billingPeriodStart,
      endDate: billingPeriodEnd
    });
    
    logger.info(\`Found \${timeEntries.length} time entries for client \${clientId}\`);
    
    // Calculate invoice amount
    const invoiceAmount = await actions.calculateInvoiceAmount({
      timeEntries,
      clientId
    });
    
    // Store invoice data
    data.set('invoiceAmount', invoiceAmount);
    data.set('timeEntries', timeEntries);
    
    // Generate invoice
    context.setState('generating_invoice');
    
    const invoice = await actions.generateInvoice({
      clientId,
      amount: invoiceAmount,
      timeEntries,
      billingPeriodStart,
      billingPeriodEnd
    });
    
    logger.info(\`Generated invoice \${invoice.id} for client \${clientId}\`);
    
    // Send notification
    await actions.sendNotification({
      type: 'invoice_generated',
      recipients: ['billing_admin'],
      data: {
        invoiceId: invoice.id,
        clientId,
        amount: invoiceAmount
      }
    });
    
    // Final state
    context.setState('completed');
  } catch (error) {
    logger.error('Error generating invoice', error);
    context.setState('failed');
  }
}`
      },
      parameter_schema: {
        type: 'object',
        properties: {
          notifyClient: {
            type: 'boolean',
            description: 'Whether to notify the client when invoice is generated',
            default: false
          },
          autoFinalize: {
            type: 'boolean',
            description: 'Whether to automatically finalize the invoice',
            default: false
          }
        }
      },
      default_parameters: {
        notifyClient: false,
        autoFinalize: false
      }
    },
    {
      name: 'Ticket Escalation',
      description: 'Escalate support tickets based on SLAs',
      category: 'Support',
      tags: ['tickets', 'support', 'escalation'],
      definition: {
        metadata: {
          name: 'TicketEscalation',
          description: 'Escalate support tickets based on SLAs',
          version: '1.0.0',
          author: 'System',
          tags: ['tickets', 'support', 'escalation']
        },
        executeFn: `/**
 * Ticket Escalation Workflow
 * Escalates tickets based on SLA breaches
 *
 * @param context The workflow context provided by the runtime
 */
async function ticketEscalationWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('monitoring');
  logger.info('Starting ticket escalation workflow');
  
  // Wait for SLA breach event
  const slaEvent = await events.waitFor('TicketSLABreach');
  logger.info('Received SLA breach event', slaEvent.payload);
  
  // Extract ticket info
  const { ticketId, breachType, currentAssignee } = slaEvent.payload;
  
  // Update state
  context.setState('escalating');
  
  try {
    // Get ticket details
    const ticket = await actions.getTicketDetails({
      ticketId
    });
    
    // Determine escalation level
    let escalationLevel;
    if (breachType === 'response') {
      escalationLevel = 'level_1';
    } else if (breachType === 'resolution') {
      escalationLevel = 'level_2';
    } else {
      escalationLevel = 'level_1';
    }
    
    // Get escalation manager
    const manager = await actions.getEscalationManager({
      level: escalationLevel,
      department: ticket.department
    });
    
    // Escalate ticket
    await actions.escalateTicket({
      ticketId,
      escalationLevel,
      assignTo: manager.userId,
      reason: \`SLA breach: \${breachType}\`
    });
    
    logger.info(\`Escalated ticket \${ticketId} to \${manager.name} (\${escalationLevel})\`);
    
    // Notify manager
    await actions.sendNotification({
      type: 'ticket_escalated',
      recipients: [manager.userId],
      data: {
        ticketId,
        escalationLevel,
        breachType,
        previousAssignee: currentAssignee
      }
    });
    
    // Notify previous assignee
    await actions.sendNotification({
      type: 'ticket_reassigned',
      recipients: [currentAssignee],
      data: {
        ticketId,
        newAssignee: manager.name,
        reason: \`SLA breach: \${breachType}\`
      }
    });
    
    // Final state
    context.setState('completed');
  } catch (error) {
    logger.error('Error escalating ticket', error);
    context.setState('failed');
  }
}`
      },
      parameter_schema: {
        type: 'object',
        properties: {
          notifyClient: {
            type: 'boolean',
            description: 'Whether to notify the client when ticket is escalated',
            default: false
          },
          escalationLevels: {
            type: 'object',
            description: 'Escalation levels configuration',
            properties: {
              response: {
                type: 'string',
                enum: ['level_1', 'level_2', 'level_3'],
                default: 'level_1'
              },
              resolution: {
                type: 'string',
                enum: ['level_1', 'level_2', 'level_3'],
                default: 'level_2'
              }
            }
          }
        }
      },
      default_parameters: {
        notifyClient: false,
        escalationLevels: {
          response: 'level_1',
          resolution: 'level_2'
        }
      }
    },
    {
      name: 'Asset Inventory Notifications',
      description: 'Alert when assets need maintenance',
      category: 'Assets',
      tags: ['assets', 'maintenance', 'notifications'],
      definition: {
        metadata: {
          name: 'AssetInventoryNotifications',
          description: 'Alert when assets need maintenance',
          version: '1.0.0',
          author: 'System',
          tags: ['assets', 'maintenance', 'notifications']
        },
        executeFn: `/**
 * Asset Inventory Notifications Workflow
 * Sends notifications for assets that need maintenance
 *
 * @param context The workflow context provided by the runtime
 */
async function assetInventoryWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('checking_assets');
  logger.info('Starting asset inventory check workflow');
  
  try {
    // Get assets that need maintenance
    const assets = await actions.getAssetsNeedingMaintenance();
    
    logger.info(\`Found \${assets.length} assets needing maintenance\`);
    
    if (assets.length === 0) {
      // No assets need maintenance
      context.setState('completed');
      return;
    }
    
    // Group assets by client
    const assetsByClient = {};
    for (const asset of assets) {
      if (!assetsByClient[asset.clientId]) {
        assetsByClient[asset.clientId] = [];
      }
      assetsByClient[asset.clientId].push(asset);
    }
    
    // Update state
    context.setState('sending_notifications');
    
    // Send notifications to asset managers
    for (const clientId in assetsByClient) {
      const clientAssets = assetsByClient[clientId];
      
      // Get asset manager for client
      const assetManager = await actions.getAssetManager({
        clientId
      });
      
      // Send notification
      await actions.sendNotification({
        type: 'assets_need_maintenance',
        recipients: [assetManager.userId],
        data: {
          clientId,
          assetCount: clientAssets.length,
          assets: clientAssets.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            lastMaintenance: a.lastMaintenance,
            maintenanceDue: a.maintenanceDue
          }))
        }
      });
      
      logger.info(\`Sent maintenance notification for \${clientAssets.length} assets to \${assetManager.name}\`);
    }
    
    // Final state
    context.setState('completed');
  } catch (error) {
    logger.error('Error checking assets', error);
    context.setState('failed');
  }
}`
      }
    },
    {
      name: 'Approval Workflows',
      description: 'Multi-step approval processes',
      category: 'Approvals',
      tags: ['approvals', 'workflow'],
      definition: {
        metadata: {
          name: 'ApprovalWorkflow',
          description: 'Multi-step approval processes',
          version: '1.0.0',
          author: 'System',
          tags: ['approvals', 'workflow']
        },
        executeFn: `/**
 * Approval Workflow
 * Handles multi-step approval processes
 *
 * @param context The workflow context provided by the runtime
 */
async function approvalWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('initiated');
  logger.info('Starting approval workflow');
  
  // Wait for approval request event
  const requestEvent = await events.waitFor('ApprovalRequested');
  logger.info('Received approval request', requestEvent.payload);
  
  // Extract request details
  const { requestId, requestType, requestedBy, itemId, approvalChain } = requestEvent.payload;
  
  // Store request data
  data.set('requestId', requestId);
  data.set('requestType', requestType);
  data.set('requestedBy', requestedBy);
  data.set('itemId', itemId);
  
  // Process each approval step
  const approvalSteps = approvalChain || ['manager', 'director', 'finance'];
  
  for (let i = 0; i < approvalSteps.length; i++) {
    const approverRole = approvalSteps[i];
    
    // Update state
    context.setState(\`awaiting_\${approverRole}_approval\`);
    
    // Get approver for this step
    const approver = await actions.getApprover({
      role: approverRole,
      requestType,
      requestedBy
    });
    
    // Create approval task
    const taskId = await actions.createApprovalTask({
      requestId,
      approverId: approver.userId,
      approverRole,
      stepNumber: i + 1,
      totalSteps: approvalSteps.length
    });
    
    logger.info(\`Created approval task \${taskId} for \${approver.name} (\${approverRole})\`);
    
    // Wait for approval response
    const approvalEvent = await events.waitFor('ApprovalResponse', {
      filter: (event) => event.payload.requestId === requestId && event.payload.approverRole === approverRole
    });
    
    const { approved, comments } = approvalEvent.payload;
    
    // Store approval data
    data.set(\`approval_\${approverRole}\`, {
      approved,
      comments,
      timestamp: new Date().toISOString()
    });
    
    // If rejected, end workflow
    if (!approved) {
      context.setState('rejected');
      
      // Notify requester of rejection
      await actions.sendNotification({
        type: 'approval_rejected',
        recipients: [requestedBy],
        data: {
          requestId,
          requestType,
          rejectedBy: approver.name,
          rejectedByRole: approverRole,
          comments
        }
      });
      
      logger.info(\`Request \${requestId} rejected by \${approver.name} (\${approverRole})\`);
      return;
    }
    
    logger.info(\`Request \${requestId} approved by \${approver.name} (\${approverRole})\`);
  }
  
  // All approvals received
  context.setState('approved');
  
  // Execute the approved action
  try {
    await actions.executeApprovedAction({
      requestId,
      requestType,
      itemId
    });
    
    // Notify requester of approval
    await actions.sendNotification({
      type: 'approval_complete',
      recipients: [requestedBy],
      data: {
        requestId,
        requestType,
        itemId
      }
    });
    
    // Final state
    context.setState('completed');
    logger.info(\`Request \${requestId} fully approved and executed\`);
  } catch (error) {
    logger.error(\`Error executing approved action for request \${requestId}\`, error);
    context.setState('execution_failed');
  }
}`
      },
      parameter_schema: {
        type: 'object',
        properties: {
          approvalChain: {
            type: 'array',
            description: 'The chain of approvers by role',
            items: {
              type: 'string'
            },
            default: ['manager', 'director', 'finance']
          },
          timeoutDays: {
            type: 'number',
            description: 'Number of days before approval request times out',
            default: 7
          },
          escalateOnTimeout: {
            type: 'boolean',
            description: 'Whether to escalate when approval times out',
            default: true
          }
        }
      },
      default_parameters: {
        approvalChain: ['manager', 'director', 'finance'],
        timeoutDays: 7,
        escalateOnTimeout: true
      }
    }
  ];
  
  // Insert templates
  for (const template of templates) {
    const categoryId = categoryMap[template.category];
    
    await knex('workflow_templates').insert({
      tenant_id: tenant.tenant,
      name: template.name,
      description: template.description,
      category: template.category,
      tags: template.tags,
      version: '1.0.0',
      status: 'published',
      definition: JSON.stringify(template.definition),
      parameter_schema: template.parameter_schema ? JSON.stringify(template.parameter_schema) : null,
      default_parameters: template.default_parameters ? JSON.stringify(template.default_parameters) : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  
  console.log(`Seeded ${templates.length} workflow templates`);
};