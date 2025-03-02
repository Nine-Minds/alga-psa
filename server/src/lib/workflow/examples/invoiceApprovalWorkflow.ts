import { defineWorkflow } from '../core/workflowDefinition';
import { WorkflowContext } from '../core/workflowContext';

/**
 * Invoice data model
 */
interface InvoiceData {
  id: string;
  amount: number;
  submitter: string;
  approver?: string;
  status: string;
}

/**
 * Invoice approval workflow
 */
export const invoiceApprovalWorkflow = defineWorkflow(
  {
    name: 'InvoiceApproval',
    description: 'Workflow for approving invoices',
    version: '1.0.0',
    tags: ['finance', 'approval']
  },
  async (context: WorkflowContext) => {
    const { actions, data, events, logger } = context;
    
    // Initialize or load data
    const invoice = data.get<InvoiceData>('invoice');
    
    // Log workflow start
    logger.info(`Starting invoice approval workflow for invoice ${invoice.id}`);
    
    // Initial state - Draft
    context.setState('draft');
    invoice.status = 'draft';
    data.set('invoice', invoice);
    
    // Wait for Submit event
    const submitEvent = await events.waitFor('Submit');
    logger.info(`Invoice submitted by ${submitEvent.payload.submittedBy}`);
    
    // Update invoice with submission details
    invoice.submitter = submitEvent.payload.submittedBy;
    invoice.status = 'submitted';
    data.set('invoice', invoice);
    
    // Execute notification actions in parallel
    await Promise.all([
      actions.send_notification({
        recipient: 'manager',
        message: `Invoice ${invoice.id} submitted for approval`
      }),
      actions.log_audit_event({
        eventType: 'invoice_submitted',
        entityId: invoice.id,
        user: submitEvent.payload.submittedBy
      })
    ]);
    
    // Update state to submitted
    context.setState('submitted');
    
    // Wait for decision event (Approve or Reject)
    const decisionEvent = await events.waitFor(['Approve', 'Reject']);
    
    // Handle approval
    if (decisionEvent.name === 'Approve') {
      // Verify approver role if amount is large
      if (invoice.amount >= 1000) {
        const userRole = await actions.get_user_role({
          userId: decisionEvent.user_id
        });
        
        if (userRole !== 'manager' && userRole !== 'senior_manager') {
          throw new Error('Only managers can approve invoices over $1000');
        }
      }
      
      // Update invoice status
      invoice.status = 'approved';
      invoice.approver = decisionEvent.user_id;
      data.set('invoice', invoice);
      
      // Execute approval actions
      await actions.send_notification({
        recipient: 'accountant',
        message: `Invoice ${invoice.id} approved by ${decisionEvent.user_id}`
      });
      
      await actions.update_invoice_status({
        invoiceId: invoice.id,
        status: 'approved'
      });
      
      logger.info(`Invoice ${invoice.id} approved by ${decisionEvent.user_id}`);
      
      // Update state to approved
      context.setState('approved');
      
      // Wait for payment event
      const payEvent = await events.waitFor('Pay');
      
      // Process payment
      const payment = await actions.generate_payment({
        invoiceId: invoice.id,
        amount: invoice.amount
      });
      
      await actions.record_payment({
        invoiceId: invoice.id,
        paymentId: payment.id,
        amount: payment.amount
      });
      
      await actions.send_receipt({
        invoiceId: invoice.id,
        recipient: invoice.submitter,
        paymentId: payment.id
      });
      
      // Final status update
      invoice.status = 'paid';
      data.set('invoice', invoice);
      
      // Update state to paid
      context.setState('paid');
      
      logger.info(`Invoice ${invoice.id} payment processed`);
    } 
    // Handle rejection
    else {
      // Update invoice status
      invoice.status = 'rejected';
      invoice.approver = decisionEvent.user_id;
      data.set('invoice', invoice);
      
      // Execute rejection actions
      await actions.send_notification({
        recipient: invoice.submitter,
        message: `Invoice ${invoice.id} rejected by ${decisionEvent.user_id}`
      });
      
      await actions.update_invoice_status({
        invoiceId: invoice.id,
        status: 'rejected'
      });
      
      // Update state to rejected
      context.setState('rejected');
      
      logger.info(`Invoice ${invoice.id} rejected by ${decisionEvent.user_id}`);
    }
    
    // Workflow complete
    logger.info(`Invoice workflow completed for ${invoice.id} with status ${invoice.status}`);
  }
);
