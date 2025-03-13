/**
 * Seed file for workflow registrations
 * This creates workflow registrations and versions for the InvoiceApproval workflow
 * that is used in the workflow_data seed file
 */

const { v4: uuidv4 } = require('uuid');

exports.seed = async function(knex) {
  // Get the tenant ID from the tenants table
  const tenantRecord = await knex('tenants').select('tenant').first();
  if (!tenantRecord) {
    console.error('No tenant found in the database. Please run the tenant seed first.');
    return;
  }
  
  // Use the tenant ID from the database
  const tenant = tenantRecord.tenant;
  
  // Check if the InvoiceApproval registration already exists
  const existingRegistration = await knex('workflow_registrations')
    .where('tenant_id', tenant)
    .where('name', 'InvoiceApproval')
    .first();
    
  if (existingRegistration) {
    console.log('InvoiceApproval workflow registration already exists, skipping seed');
    return;
  }
  
  // Get the Approval Workflows template to use as a base
  const approvalTemplate = await knex('workflow_templates')
    .where('tenant_id', tenant)
    .where('name', 'Approval Workflows')
    .first();
    
  if (!approvalTemplate) {
    console.error('Approval Workflows template not found. Please run the workflow_templates seed first.');
    return;
  }
  
  // Create a modified definition for InvoiceApproval
  const invoiceApprovalDefinition = {
    metadata: {
      name: 'InvoiceApproval',
      description: 'Workflow for approving and processing invoices',
      version: '1.0.0',
      author: 'System',
      tags: ['invoice', 'approval', 'finance']
    },
    // Store just the function body, not the entire function declaration
    // This is what the deserializer expects
    executeFn: `
/**
 * Invoice Approval Workflow
 *
 * A workflow for approving and processing invoices.
 *
 * @param context The workflow context provided by the runtime
 */
async function invoiceApprovalWorkflow(context): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('draft');
  logger.info('Starting invoice approval workflow');
  
  // Get input data from the trigger event
  const { submittedBy } = context.input.triggerEvent.payload;
  logger.info(\`Processing invoice submission from \${submittedBy}\`);
  
  // Update state
  context.setState('submitted');
  
  // Send notification to approvers
  await actions.send_notification({
    type: 'invoice_submitted',
    recipients: ['finance_approvers'],
    data: {
      invoiceId: data.get('invoice.id'),
      amount: data.get('invoice.amount'),
      submitter: submittedBy
    }
  });
  
  // Log audit event
  await actions.log_audit_event({
    action: 'invoice_submitted',
    user: submittedBy,
    details: {
      invoiceId: data.get('invoice.id'),
      amount: data.get('invoice.amount')
    }
  });
  
  // Get decision event from the trigger event
  const decisionEvent = context.input.triggerEvent;
  logger.info(\`Processing decision: \${decisionEvent.name}\`);
  
  if (decisionEvent.name === 'Approve') {
    // Handle approval
    const { approver } = decisionEvent.payload;
    
    // Check user role
    const userRole = await actions.get_user_role({ userId: approver });
    
    // Verify approver has permission
    if (userRole !== 'finance_approver' && userRole !== 'admin') {
      logger.error('User does not have approval permission', { approver, role: userRole });
      throw new Error('Unauthorized approval attempt');
    }
    
    // Update state
    context.setState('approved');
    
    // Update invoice status
    await actions.update_invoice_status({
      invoiceId: data.get('invoice.id'),
      status: 'approved',
      approvedBy: approver
    });
    
    // Send notification
    await actions.send_notification({
      type: 'invoice_approved',
      recipients: [data.get('invoice.submitter')],
      data: {
        invoiceId: data.get('invoice.id'),
        approver
      }
    });
    
    // Get payment data from the trigger event
    const payEvent = context.input.triggerEvent;
    logger.info(\`Processing payment for invoice \${data.get('invoice.id')}\`);
    
    // Update state
    context.setState('paid');
    
    // Generate payment
    const paymentResult = await actions.generate_payment({
      invoiceId: data.get('invoice.id'),
      amount: data.get('invoice.amount')
    });
    
    // Record payment
    await actions.record_payment({
      invoiceId: data.get('invoice.id'),
      paymentId: paymentResult.paymentId,
      amount: data.get('invoice.amount'),
      date: new Date().toISOString()
    });
    
    // Send receipt
    await actions.send_receipt({
      to: data.get('invoice.submitter'),
      invoiceId: data.get('invoice.id'),
      paymentId: paymentResult.paymentId,
      amount: data.get('invoice.amount')
    });
    
    // Final state
    context.setState('completed');
    logger.info('Invoice workflow completed successfully');
  } else {
    // Handle rejection
    const { approver, reason } = decisionEvent.payload;
    
    // Update state
    context.setState('rejected');
    
    // Update invoice status
    await actions.update_invoice_status({
      invoiceId: data.get('invoice.id'),
      status: 'rejected',
      rejectedBy: approver,
      reason
    });
    
    // Send notification
    await actions.send_notification({
      type: 'invoice_rejected',
      recipients: [data.get('invoice.submitter')],
      data: {
        invoiceId: data.get('invoice.id'),
        rejectedBy: approver,
        reason
      }
    });
    
    logger.info('Invoice rejected', { approver, reason });
  }
}
`
  };
  
  // Create the workflow registration
  const registrationId = uuidv4();
  await knex('workflow_registrations').insert({
    registration_id: registrationId,
    tenant_id: tenant,
    name: 'InvoiceApproval',
    description: 'Workflow for approving and processing invoices',
    category: 'Approvals',
    tags: ['invoice', 'approval', 'finance'],
    version: '1.0.0',
    status: 'active',
    source_template_id: approvalTemplate.template_id,
    definition: JSON.stringify(invoiceApprovalDefinition),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  
  // Create the workflow registration version
  const versionId = uuidv4();
  await knex('workflow_registration_versions').insert({
    version_id: versionId,
    tenant_id: tenant,
    registration_id: registrationId,
    version: '1.0.0',
    is_current: true,
    definition: JSON.stringify(invoiceApprovalDefinition),
    parameters: JSON.stringify({
      approvalChain: ['finance_manager', 'finance_director'],
      timeoutDays: 5,
      escalateOnTimeout: true
    }),
    created_at: new Date().toISOString()
  });
  
  console.log(`Created InvoiceApproval workflow registration and version with ID ${registrationId}`);
  console.log(`Created version with ID ${versionId}`);
};