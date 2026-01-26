const { randomUUID } = require('node:crypto');

function buildPayload({ schemaRef, fixtureName, correlationKey }) {
  switch (schemaRef) {
    case 'payload.TicketCreated.v1':
      return { ticketId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    case 'payload.TicketUpdated.v1':
      return { ticketId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    case 'payload.TicketAssigned.v1':
      return { ticketId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TicketUnassigned.v1':
      return {
        ticketId: randomUUID(),
        previousAssigneeId: randomUUID(),
        previousAssigneeType: 'user',
        fixtureName,
        correlationKey
      };
    case 'payload.TicketReopened.v1':
      return { ticketId: randomUUID(), previousStatusId: 'prev', newStatusId: 'new', fixtureName, correlationKey };
    case 'payload.TicketClosed.v1':
      return { ticketId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    case 'payload.TicketStatusChanged.v1':
      return { ticketId: randomUUID(), previousStatusId: 'prev', newStatusId: 'new', fixtureName, correlationKey };
    case 'payload.TicketPriorityChanged.v1':
      return { ticketId: randomUUID(), previousPriorityId: 'prev', newPriorityId: 'new', fixtureName, correlationKey };
    case 'payload.TicketTagsChanged.v1':
      return { ticketId: randomUUID(), addedTagIds: [randomUUID()], removedTagIds: [randomUUID()], fixtureName, correlationKey };
    case 'payload.TicketQueueChanged.v1':
      return { ticketId: randomUUID(), previousBoardId: randomUUID(), newBoardId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TicketEscalated.v1':
      return { ticketId: randomUUID(), fromQueueId: randomUUID(), toQueueId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TicketMerged.v1':
      return { sourceTicketId: randomUUID(), targetTicketId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TicketSplit.v1':
      return { originalTicketId: randomUUID(), newTicketIds: [randomUUID()], fixtureName, correlationKey };
    case 'payload.TicketMessageAdded.v1':
      return {
        ticketId: randomUUID(),
        messageId: randomUUID(),
        visibility: 'public',
        authorId: randomUUID(),
        authorType: 'user',
        channel: 'api',
        fixtureName,
        correlationKey
      };
    case 'payload.TicketCustomerReplied.v1':
      return {
        ticketId: randomUUID(),
        messageId: randomUUID(),
        contactId: randomUUID(),
        channel: 'email',
        fixtureName,
        correlationKey
      };
    case 'payload.TicketInternalNoteAdded.v1':
      return { ticketId: randomUUID(), noteId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TicketTimeEntryAdded.v1':
      return { ticketId: randomUUID(), timeEntryId: randomUUID(), minutes: 15, billable: true, fixtureName, correlationKey };
    case 'payload.TicketSlaStageEntered.v1':
      return { ticketId: randomUUID(), slaPolicyId: randomUUID(), stage: 'response', fixtureName, correlationKey };
    case 'payload.TicketSlaStageMet.v1':
      return { ticketId: randomUUID(), slaPolicyId: randomUUID(), stage: 'resolution', fixtureName, correlationKey };
    case 'payload.TicketSlaStageBreached.v1':
      return { ticketId: randomUUID(), slaPolicyId: randomUUID(), stage: 'custom', fixtureName, correlationKey };
    case 'payload.TicketApprovalRequested.v1':
      return { ticketId: randomUUID(), approvalRequestId: randomUUID(), approvalType: 'standard', fixtureName, correlationKey };
    case 'payload.TicketApprovalGranted.v1':
      return { ticketId: randomUUID(), approvalRequestId: randomUUID(), approvalType: 'standard', fixtureName, correlationKey };
    case 'payload.TicketApprovalRejected.v1':
      return { ticketId: randomUUID(), approvalRequestId: randomUUID(), approvalType: 'standard', fixtureName, correlationKey };

    case 'payload.ProjectCreated.v1':
      return { projectId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectUpdated.v1':
      return { projectId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    case 'payload.ProjectStatusChanged.v1':
      return { projectId: randomUUID(), previousStatus: 'prev', newStatus: 'new', fixtureName, correlationKey };
    case 'payload.ProjectTaskCreated.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectTaskAssigned.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), assigneeId: randomUUID(), assigneeType: 'user', fixtureName, correlationKey };
    case 'payload.ProjectTaskStatusChanged.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), previousStatus: 'prev', newStatus: 'new', fixtureName, correlationKey };
    case 'payload.ProjectTaskCompleted.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectTaskDependencyBlocked.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), dependsOnTaskId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectTaskDependencyUnblocked.v1':
      return { projectId: randomUUID(), taskId: randomUUID(), dependsOnTaskId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectApprovalRequested.v1':
      return { projectId: randomUUID(), approvalRequestId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectApprovalGranted.v1':
      return { projectId: randomUUID(), approvalRequestId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ProjectApprovalRejected.v1':
      return { projectId: randomUUID(), approvalRequestId: randomUUID(), fixtureName, correlationKey };

    case 'payload.AppointmentCreated.v1':
      return { appointmentId: randomUUID(), fixtureName, correlationKey };
    case 'payload.AppointmentRescheduled.v1':
      return { appointmentId: randomUUID(), fixtureName, correlationKey };
    case 'payload.AppointmentCanceled.v1':
      return { appointmentId: randomUUID(), fixtureName, correlationKey };
    case 'payload.AppointmentCompleted.v1':
      return { appointmentId: randomUUID(), durationMinutes: 30, fixtureName, correlationKey };
    case 'payload.AppointmentNoShow.v1':
      return { appointmentId: randomUUID(), fixtureName, correlationKey };
    case 'payload.AppointmentAssigned.v1':
      return { appointmentId: randomUUID(), assignedToUserId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ScheduleBlockCreated.v1':
      return { scheduleBlockId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ScheduleBlockDeleted.v1':
      return { scheduleBlockId: randomUUID(), fixtureName, correlationKey };
    case 'payload.CapacityThresholdReached.v1':
      return { thresholdId: randomUUID(), capacity: 100, used: 101, fixtureName, correlationKey };
    case 'payload.TechnicianDispatched.v1':
      return { dispatchId: randomUUID(), ticketId: randomUUID(), technicianUserId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TechnicianEnRoute.v1':
      return { dispatchId: randomUUID(), ticketId: randomUUID(), technicianUserId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TechnicianArrived.v1':
      return { dispatchId: randomUUID(), ticketId: randomUUID(), technicianUserId: randomUUID(), fixtureName, correlationKey };
    case 'payload.TechnicianCheckedOut.v1':
      return { dispatchId: randomUUID(), ticketId: randomUUID(), technicianUserId: randomUUID(), fixtureName, correlationKey };

    case 'payload.InvoiceGenerated.v1':
      return { invoiceId: randomUUID(), fixtureName, correlationKey };
    case 'payload.InvoiceFinalized.v1':
      return { invoiceId: randomUUID(), fixtureName, correlationKey };
    case 'payload.InvoiceSent.v1':
      return { invoiceId: randomUUID(), deliveryMethod: 'email', fixtureName, correlationKey };
    case 'payload.InvoiceStatusChanged.v1':
      return { invoiceId: randomUUID(), previousStatus: 'prev', newStatus: 'new', fixtureName, correlationKey };
    case 'payload.InvoiceDueDateChanged.v1':
      return { invoiceId: randomUUID(), previousDueDate: 'prev', newDueDate: 'new', fixtureName, correlationKey };
    case 'payload.InvoiceOverdue.v1':
      return {
        invoiceId: randomUUID(),
        dueDate: '2026-01-01',
        amountDue: '1.00',
        currency: 'USD',
        daysOverdue: 1,
        fixtureName,
        correlationKey
      };
    case 'payload.InvoiceWrittenOff.v1':
      return { invoiceId: randomUUID(), amountWrittenOff: '1.00', currency: 'USD', fixtureName, correlationKey };
    case 'payload.PaymentRecorded.v1':
      return { paymentId: randomUUID(), amount: '1.00', currency: 'USD', method: 'card', fixtureName, correlationKey };
    case 'payload.PaymentApplied.v1':
      return { paymentId: randomUUID(), applications: [{ invoiceId: randomUUID(), amountApplied: '1.00' }], fixtureName, correlationKey };
    case 'payload.PaymentFailed.v1':
      return { paymentId: randomUUID(), amount: '1.00', currency: 'USD', method: 'card', fixtureName, correlationKey };
    case 'payload.ContractCreated.v1':
      return { contractId: randomUUID(), clientId: randomUUID(), fixtureName, correlationKey };
    case 'payload.ContractUpdated.v1':
      return { contractId: randomUUID(), clientId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    case 'payload.ContractStatusChanged.v1':
      return { contractId: randomUUID(), clientId: randomUUID(), previousStatus: 'prev', newStatus: 'new', fixtureName, correlationKey };
    case 'payload.ContractRenewalUpcoming.v1':
      return { contractId: randomUUID(), clientId: randomUUID(), renewalDate: '2026-12-31', fixtureName, correlationKey };

    case 'payload.CompanyCreated.v1':
      return { companyId: randomUUID(), fixtureName, correlationKey };
    case 'payload.CompanyUpdated.v1':
      return { companyId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
    default:
      return { ticketId: randomUUID(), updatedFields: [], changes: {}, fixtureName, correlationKey };
  }
}

async function runScaffoldedFixture(ctx, { fixtureName, eventName, schemaRef }) {
  const correlationKey = randomUUID();
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName,
      correlationKey,
      payloadSchemaRef: schemaRef,
      payload: buildPayload({ schemaRef, fixtureName, correlationKey })
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  ctx.expect.equal(runRow.status, 'SUCCEEDED', 'run status');
}

module.exports = { runScaffoldedFixture, buildPayload };

