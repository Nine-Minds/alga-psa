# Workflow Event Catalog v2 — Domain Event Proposals

This is a **proposal/backlog** of business-relevant events to add to the Workflow Event Catalog (v2), derived from the NX “domain layer” packages (tickets, clients/contacts, billing, projects, scheduling, documents, integrations, etc).

## Conventions (recommended)

- `event_type`: `SCREAMING_SNAKE_CASE` (matches existing catalog entries).
- `category`: user-facing module grouping used by the catalog UI (Tickets, Billing, Projects, CRM, Email Processing, Integrations, Documents, etc).
- Payload:
  - Include `tenantId` on all tenant-scoped events.
  - Include an “actor” where meaningful: `actorUserId` (staff), `actorContactId` (client), plus `actorType` when ambiguous.
  - For state transitions, include `previousX` / `newX`.
  - For “entity changed” events, include a normalized `changes` object (or `updatedFields[]`).
- `payload_schema_ref` naming: `payload.<PascalEventName>.v1` (example: `payload.TicketStatusChanged.v1`).

## Already present (avoid duplicating)

Found in code/migrations:

- `COMPANY_CREATED`, `COMPANY_UPDATED`
- `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_RESPONSE_STATE_CHANGED`
- `PROJECT_CREATED`
- `INVOICE_GENERATED`, `INVOICE_FINALIZED`
- `INBOUND_EMAIL_RECEIVED`
- `EMAIL_PROVIDER_CONNECTED`, `EMAIL_PROVIDER_DISCONNECTED`

## Proposed Events (by category)

Each entry is: `event_type` — **Name**: Description *(payload fields)*.

### Tickets (`packages/tickets`)

- `TICKET_STATUS_CHANGED` — **Ticket Status Changed**: Ticket moved between statuses. *(tenantId, ticketId, previousStatusId, newStatusId, actorUserId, changedAt, reason?)*
- `TICKET_PRIORITY_CHANGED` — **Ticket Priority Changed**: Priority updated. *(tenantId, ticketId, previousPriorityId, newPriorityId, actorUserId, changedAt, reason?)*
- `TICKET_ASSIGNED` — **Ticket Assigned**: Assigned to an agent/team. *(tenantId, ticketId, previousAssigneeId?, previousAssigneeType?, newAssigneeId, newAssigneeType, actorUserId, assignedAt)*
- `TICKET_UNASSIGNED` — **Ticket Unassigned**: Unassigned from agent/team. *(tenantId, ticketId, previousAssigneeId, previousAssigneeType, actorUserId, unassignedAt, reason?)*
- `TICKET_REOPENED` — **Ticket Reopened**: Closed ticket reopened. *(tenantId, ticketId, previousStatusId, newStatusId, actorUserId, reopenedAt, reason?)*
- `TICKET_MERGED` — **Ticket Merged**: Ticket merged into another. *(tenantId, sourceTicketId, targetTicketId, actorUserId, mergedAt, reason?)*
- `TICKET_SPLIT` — **Ticket Split**: Ticket split into multiple tickets. *(tenantId, originalTicketId, newTicketIds, actorUserId, splitAt, reason?)*
- `TICKET_TAGS_CHANGED` — **Ticket Tags Changed**: Tags applied/removed on ticket. *(tenantId, ticketId, addedTagIds?, removedTagIds?, actorUserId, changedAt)*
- `TICKET_QUEUE_CHANGED` — **Ticket Queue/Board Changed**: Ticket moved between boards/queues. *(tenantId, ticketId, previousBoardId?, newBoardId?, actorUserId, changedAt)*
- `TICKET_ESCALATED` — **Ticket Escalated**: Escalated to higher tier/team/queue. *(tenantId, ticketId, fromQueueId?, toQueueId?, actorUserId, escalatedAt, reason?)*
- `TICKET_MESSAGE_ADDED` — **Ticket Message Added**: Any message/comment added (public/private). *(tenantId, ticketId, messageId, visibility(public|internal), authorId, authorType(user|contact), channel(email|portal|ui|api), createdAt, attachmentsCount?)*
- `TICKET_CUSTOMER_REPLIED` — **Ticket Customer Replied**: Customer reply received (portal/email). *(tenantId, ticketId, messageId, contactId, channel, receivedAt, attachmentsCount?)*
- `TICKET_INTERNAL_NOTE_ADDED` — **Ticket Internal Note Added**: Internal/private note added. *(tenantId, ticketId, noteId, actorUserId, createdAt)*
- `TICKET_TIME_ENTRY_ADDED` — **Ticket Time Entry Added**: Time logged against ticket. *(tenantId, ticketId, timeEntryId, actorUserId, minutes, billable, createdAt)*

SLA-focused (high-value automation triggers):

- `TICKET_SLA_STAGE_ENTERED` — **Ticket SLA Stage Entered**: SLA stage started. *(tenantId, ticketId, slaPolicyId, stage(response|resolution|custom), enteredAt, targetAt)*
- `TICKET_SLA_STAGE_MET` — **Ticket SLA Stage Met**: SLA met. *(tenantId, ticketId, slaPolicyId, stage, metAt, targetAt)*
- `TICKET_SLA_STAGE_BREACHED` — **Ticket SLA Stage Breached**: SLA breached. *(tenantId, ticketId, slaPolicyId, stage, breachedAt, targetAt, overdueBySeconds)*

Approvals/escalations (optional but workflow-friendly):

- `TICKET_APPROVAL_REQUESTED` — **Ticket Approval Requested**: Request approval (access/spend/change). *(tenantId, ticketId, approvalRequestId, approvalType, requestedByUserId, requestedAt, notes?)*
- `TICKET_APPROVAL_GRANTED` — **Ticket Approval Granted**: Approval granted. *(tenantId, ticketId, approvalRequestId, approvedByUserId, approvedAt, conditions?)*
- `TICKET_APPROVAL_REJECTED` — **Ticket Approval Rejected**: Approval rejected. *(tenantId, ticketId, approvalRequestId, rejectedByUserId, rejectedAt, reason?)*

### Scheduling (`packages/scheduling`)

- `APPOINTMENT_CREATED` — **Appointment Created**: Appointment scheduled (often tied to a ticket). *(tenantId, appointmentId, ticketId?, startAt, endAt, timezone, assigneeId?, assigneeType?, createdByUserId, createdAt, location?)*
- `APPOINTMENT_RESCHEDULED` — **Appointment Rescheduled**: Time changed. *(tenantId, appointmentId, ticketId?, previousStartAt, previousEndAt, newStartAt, newEndAt, timezone, actorUserId, rescheduledAt, reason?)*
- `APPOINTMENT_CANCELED` — **Appointment Canceled**: Appointment canceled. *(tenantId, appointmentId, ticketId?, actorUserId, canceledAt, reason?)*
- `APPOINTMENT_COMPLETED` — **Appointment Completed**: Marked completed. *(tenantId, appointmentId, ticketId?, actorUserId, completedAt, outcome?)*
- `APPOINTMENT_NO_SHOW` — **Appointment No-Show**: No-show recorded. *(tenantId, appointmentId, ticketId?, actorUserId, markedAt, party(customer|agent))*
- `APPOINTMENT_ASSIGNED` — **Appointment Assigned**: Assigned/reassigned to an agent/team. *(tenantId, appointmentId, ticketId?, previousAssigneeId?, previousAssigneeType?, newAssigneeId, newAssigneeType, actorUserId, assignedAt)*
- `SCHEDULE_BLOCK_CREATED` — **Schedule Block Created**: Availability block created. *(tenantId, scheduleBlockId, ownerId, ownerType(user|team), startAt, endAt, timezone, actorUserId, createdAt, reason?)*
- `SCHEDULE_BLOCK_DELETED` — **Schedule Block Deleted**: Availability block removed. *(tenantId, scheduleBlockId, actorUserId, deletedAt, reason?)*
- `CAPACITY_THRESHOLD_REACHED` — **Capacity Threshold Reached**: Team/day capacity threshold hit. *(tenantId, teamId, date, capacityLimit, currentBooked, triggeredAt)*

Field ops (optional, if supported in product):

- `TECHNICIAN_DISPATCHED` — **Technician Dispatched**: Dispatch action taken. *(tenantId, appointmentId, ticketId?, technicianUserId, dispatchedByUserId, dispatchedAt)*
- `TECHNICIAN_EN_ROUTE` — **Technician En Route**: En route status update. *(tenantId, appointmentId, ticketId?, technicianUserId, startedAt, eta?)*
- `TECHNICIAN_ARRIVED` — **Technician Arrived**: Arrival recorded. *(tenantId, appointmentId, ticketId?, technicianUserId, arrivedAt, location?)*
- `TECHNICIAN_CHECKED_OUT` — **Technician Checked Out**: Completed onsite work. *(tenantId, appointmentId, ticketId?, technicianUserId, checkedOutAt, workSummary?)*

### Projects (`packages/projects`)

- `PROJECT_UPDATED` — **Project Updated**: Project fields changed. *(tenantId, projectId, actorUserId, updatedAt, updatedFields?, changes?)*
- `PROJECT_STATUS_CHANGED` — **Project Status Changed**: Project status transition. *(tenantId, projectId, previousStatus, newStatus, actorUserId, changedAt)*
- `PROJECT_TASK_CREATED` — **Project Task Created**: Task added. *(tenantId, taskId, projectId, createdByUserId, createdAt, title, dueDate?, status)*
- `PROJECT_TASK_ASSIGNED` — **Project Task Assigned**: Task assigned to user/team. *(tenantId, taskId, projectId, assignedToId, assignedToType(user|team), assignedByUserId, assignedAt)*
- `PROJECT_TASK_STATUS_CHANGED` — **Project Task Status Changed**: Task status transition. *(tenantId, taskId, projectId, previousStatus, newStatus, actorUserId, changedAt)*
- `PROJECT_TASK_COMPLETED` — **Project Task Completed**: Task completed. *(tenantId, taskId, projectId, completedByUserId, completedAt)*
- `PROJECT_TASK_DEPENDENCY_BLOCKED` — **Project Task Blocked**: Dependency blocks progress. *(tenantId, taskId, projectId, blockedByTaskId, blockedAt)*
- `PROJECT_TASK_DEPENDENCY_UNBLOCKED` — **Project Task Unblocked**: Dependency resolved. *(tenantId, taskId, projectId, unblockedByTaskId, unblockedAt)*

Project approvals (optional but high-value automations):

- `PROJECT_APPROVAL_REQUESTED` — **Project Approval Requested**: Scope/budget/change approval request. *(tenantId, approvalId, projectId, approvalType, requestedByUserId, requestedAt, notes?)*
- `PROJECT_APPROVAL_GRANTED` — **Project Approval Granted**: Approval granted. *(tenantId, approvalId, projectId, approvalType, approvedByUserId, approvedAt, notes?)*
- `PROJECT_APPROVAL_REJECTED` — **Project Approval Rejected**: Approval rejected. *(tenantId, approvalId, projectId, approvalType, rejectedByUserId, rejectedAt, reason?)*

### Billing (`packages/billing`)

Invoices and collections:

- `INVOICE_SENT` — **Invoice Sent**: Invoice delivered to customer. *(tenantId, invoiceId, clientId/companyId, sentByUserId, sentAt, deliveryMethod(email|portal|print))*
- `INVOICE_STATUS_CHANGED` — **Invoice Status Changed**: Status transition (draft→sent→paid, etc). *(tenantId, invoiceId, previousStatus, newStatus, actorUserId, changedAt)*
- `INVOICE_DUE_DATE_CHANGED` — **Invoice Due Date Changed**: Due date updated. *(tenantId, invoiceId, previousDueDate, newDueDate, actorUserId, changedAt)*
- `INVOICE_OVERDUE` — **Invoice Overdue**: Invoice became overdue. *(tenantId, invoiceId, clientId/companyId, overdueAt, dueDate, amountDue, currency, daysOverdue)*
- `INVOICE_WRITTEN_OFF` — **Invoice Written Off**: Invoice written off. *(tenantId, invoiceId, actorUserId, writtenOffAt, amountWrittenOff, currency, reason?)*

Payments:

- `PAYMENT_RECORDED` — **Payment Recorded**: Payment created/recorded. *(tenantId, paymentId, clientId/companyId, receivedAt, amount, currency, method, receivedByUserId?, gatewayTransactionId?)*
- `PAYMENT_APPLIED` — **Payment Applied**: Payment applied to invoices. *(tenantId, paymentId, appliedAt, appliedByUserId, applications[{invoiceId, amountApplied}])*
- `PAYMENT_FAILED` — **Payment Failed**: Payment attempt failed. *(tenantId, paymentId?, invoiceId?, clientId/companyId, failedAt, amount, currency, method, failureCode?, failureMessage?, retryable?)*
- `PAYMENT_REFUNDED` — **Payment Refunded**: Refund issued. *(tenantId, paymentId, refundedAt, refundedByUserId, amount, currency, reason?)*

Credits:

- `CREDIT_NOTE_CREATED` — **Credit Note Created**: Credit issued. *(tenantId, creditNoteId, clientId/companyId, createdByUserId, createdAt, amount, currency, status)*
- `CREDIT_NOTE_APPLIED` — **Credit Note Applied**: Credit applied to invoice. *(tenantId, creditNoteId, invoiceId, appliedByUserId, appliedAt, amountApplied, currency)*
- `CREDIT_NOTE_VOIDED` — **Credit Note Voided**: Credit voided. *(tenantId, creditNoteId, voidedByUserId, voidedAt, reason?)*

Contracts / recurring:

- `CONTRACT_CREATED` — **Contract Created**: Client contract created. *(tenantId, contractId, clientId, createdByUserId, createdAt, startDate?, endDate?, status?)*
- `CONTRACT_UPDATED` — **Contract Updated**: Contract fields changed. *(tenantId, contractId, clientId, actorUserId, updatedAt, updatedFields?, changes?)*
- `CONTRACT_STATUS_CHANGED` — **Contract Status Changed**: Contract lifecycle change. *(tenantId, contractId, clientId, previousStatus, newStatus, actorUserId, changedAt)*
- `CONTRACT_RENEWAL_UPCOMING` — **Contract Renewal Upcoming**: Renewal is approaching. *(tenantId, contractId, clientId, renewalAt, daysUntilRenewal)*
- `RECURRING_BILLING_RUN_STARTED` — **Recurring Billing Run Started**: Run begins. *(tenantId, runId, scheduleId?, startedAt, initiatedByUserId?)*
- `RECURRING_BILLING_RUN_COMPLETED` — **Recurring Billing Run Completed**: Run completes. *(tenantId, runId, completedAt, invoicesCreated, failedCount, warnings?)*
- `RECURRING_BILLING_RUN_FAILED` — **Recurring Billing Run Failed**: Run fails. *(tenantId, runId, failedAt, errorCode?, errorMessage, retryable?)*

### CRM: Clients/Contacts/Interactions (`packages/clients`, `packages/tags`)

Clients:

- `CLIENT_CREATED` — **Client Created**: Client/account created. *(tenantId, clientId, clientName, createdByUserId, createdAt, status?)*
- `CLIENT_UPDATED` — **Client Updated**: Client fields changed. *(tenantId, clientId, updatedByUserId, updatedAt, updatedFields?, changes?)*
- `CLIENT_STATUS_CHANGED` — **Client Status Changed**: Lifecycle status transition (prospect→active, etc). *(tenantId, clientId, previousStatus, newStatus, actorUserId, changedAt)*
- `CLIENT_OWNER_ASSIGNED` — **Client Owner Assigned**: Account manager assigned/reassigned. *(tenantId, clientId, previousOwnerUserId?, newOwnerUserId, assignedByUserId, assignedAt)*
- `CLIENT_MERGED` — **Client Merged**: Client merged into another. *(tenantId, sourceClientId, targetClientId, mergedByUserId, mergedAt, strategy?)*
- `CLIENT_ARCHIVED` — **Client Archived**: Client archived/deactivated. *(tenantId, clientId, archivedByUserId, archivedAt, reason?)*

Contacts:

- `CONTACT_CREATED` — **Contact Created**: Contact added to client. *(tenantId, contactId, clientId, fullName, email?, phoneNumber?, createdByUserId, createdAt)*
- `CONTACT_UPDATED` — **Contact Updated**: Contact fields changed. *(tenantId, contactId, clientId, updatedByUserId, updatedAt, updatedFields?, changes?)*
- `CONTACT_PRIMARY_SET` — **Primary Contact Set**: Contact set as client primary/billing. *(tenantId, clientId, contactId, previousPrimaryContactId?, setByUserId, setAt)*
- `CONTACT_ARCHIVED` — **Contact Archived**: Contact deactivated/archived. *(tenantId, contactId, clientId, archivedByUserId, archivedAt, reason?)*
- `CONTACT_MERGED` — **Contact Merged**: Contact merged into another. *(tenantId, sourceContactId, targetContactId, mergedByUserId, mergedAt, strategy?)*

Interactions/notes:

- `INTERACTION_LOGGED` — **Interaction Logged**: CRM interaction recorded. *(tenantId, interactionId, clientId, contactId?, interactionType, channel, occurredAt, loggedByUserId, subject?, outcome?)*
- `NOTE_CREATED` — **Note Created**: Note attached to client/contact. *(tenantId, noteId, entityType(client|contact), entityId, createdByUserId, createdAt, visibility?, bodyPreview?)*

Tags (consider generic, cross-entity):

- `TAG_DEFINITION_CREATED` — **Tag Definition Created**: New tag created. *(tenantId, tagId, tagName, createdByUserId, createdAt)*
- `TAG_DEFINITION_UPDATED` — **Tag Definition Updated**: Tag definition changed. *(tenantId, tagId, previousName?, newName?, updatedByUserId, updatedAt)*
- `TAG_APPLIED` — **Tag Applied**: Tag applied to entity. *(tenantId, tagId, entityType, entityId, appliedByUserId, appliedAt)*
- `TAG_REMOVED` — **Tag Removed**: Tag removed from entity. *(tenantId, tagId, entityType, entityId, removedByUserId, removedAt)*

### Documents (`packages/documents`)

- `DOCUMENT_UPLOADED` — **Document Uploaded**: Document uploaded into storage. *(tenantId, documentId, uploadedByUserId, uploadedAt, fileName, contentType, sizeBytes, storageKey)*
- `DOCUMENT_DELETED` — **Document Deleted**: Document removed. *(tenantId, documentId, deletedByUserId, deletedAt, reason?)*
- `DOCUMENT_ASSOCIATED` — **Document Associated**: Document associated to an entity. *(tenantId, documentId, entityType, entityId, associatedByUserId, associatedAt)*
- `DOCUMENT_DETACHED` — **Document Detached**: Document association removed. *(tenantId, documentId, entityType, entityId, detachedByUserId, detachedAt, reason?)*
- `DOCUMENT_GENERATED` — **Document Generated**: System-generated document created (invoice/PDF/etc). *(tenantId, documentId, sourceType, sourceId, generatedByUserId?, generatedAt, fileName)*

If/when e-sign workflows exist:

- `DOCUMENT_SIGNATURE_REQUESTED` — **Document Signature Requested**: Signature requested. *(tenantId, documentId, requestId, requestedByUserId, requestedAt, signers[{email, name?}], expiresAt?)*
- `DOCUMENT_SIGNED` — **Document Signed**: Document fully signed. *(tenantId, documentId, requestId, signedAt, signerEmail?, signerId?)*
- `DOCUMENT_SIGNATURE_EXPIRED` — **Document Signature Expired**: Signature request expired. *(tenantId, documentId, requestId, expiredAt)*

### Email + Notifications + Surveys (`packages/email`, `packages/notifications`, `packages/surveys`)

Email lifecycle:

- `INBOUND_EMAIL_REPLY_RECEIVED` — **Inbound Email Reply Received**: Inbound email identified as reply to existing thread/ticket. *(tenantId, messageId, threadId, ticketId?, from, to[], subject, receivedAt, provider, matchedBy)*
- `OUTBOUND_EMAIL_QUEUED` — **Outbound Email Queued**: Outbound email queued for sending. *(tenantId, messageId, threadId?, ticketId?, from, to[], cc[]?, subject, queuedAt, provider)*
- `OUTBOUND_EMAIL_SENT` — **Outbound Email Sent**: Provider accepted outbound email. *(tenantId, messageId, providerMessageId, threadId?, ticketId?, sentAt, provider)*
- `OUTBOUND_EMAIL_FAILED` — **Outbound Email Failed**: Provider rejected/failed outbound email. *(tenantId, messageId, threadId?, ticketId?, failedAt, provider, errorCode?, errorMessage, retryable?)*
- `EMAIL_DELIVERED` — **Email Delivered**: Provider confirmed delivery. *(tenantId, messageId, providerMessageId, to, deliveredAt, provider)*
- `EMAIL_BOUNCED` — **Email Bounced**: Provider reported bounce. *(tenantId, messageId, providerMessageId, to, bouncedAt, bounceType(hard|soft), smtpCode?, smtpMessage?)*
- `EMAIL_COMPLAINT_RECEIVED` — **Email Complaint Received**: Recipient complaint/spam report. *(tenantId, messageId, providerMessageId, to, complainedAt, provider, complaintType?)*
- `EMAIL_UNSUBSCRIBED` — **Email Unsubscribed**: Recipient unsubscribed. *(tenantId, recipientEmail, unsubscribedAt, source, messageId?)*

Notifications:

- `NOTIFICATION_SENT` — **Notification Sent**: Notification queued/sent. *(tenantId, notificationId, channel(email|sms|in_app|push), recipientId, sentAt, templateId?, contextType?, contextId?)*
- `NOTIFICATION_DELIVERED` — **Notification Delivered**: Provider confirmed delivery. *(tenantId, notificationId, channel, recipientId, deliveredAt, providerMessageId?)*
- `NOTIFICATION_FAILED` — **Notification Failed**: Delivery failed. *(tenantId, notificationId, channel, recipientId, failedAt, errorCode?, errorMessage, retryable?)*
- `NOTIFICATION_READ` — **Notification Read**: Recipient opened/read notification (trackable channels only). *(tenantId, notificationId, channel, recipientId, readAt, client?)*

Surveys / CSAT:

- `SURVEY_SENT` — **Survey Sent**: Survey/CSAT request sent. *(tenantId, surveyId, surveyType(csat|nps|custom), recipientId, ticketId?, sentAt, channel, templateId?)*
- `SURVEY_RESPONSE_RECEIVED` — **Survey Response Received**: Survey response recorded. *(tenantId, surveyId, responseId, recipientId, ticketId?, respondedAt, score, comment?)*
- `SURVEY_REMINDER_SENT` — **Survey Reminder Sent**: Reminder sent. *(tenantId, surveyId, recipientId, ticketId?, sentAt, channel, reminderNumber)*
- `SURVEY_EXPIRED` — **Survey Expired**: Survey expired without response. *(tenantId, surveyId, recipientId, ticketId?, expiredAt)*
- `CSAT_ALERT_TRIGGERED` — **CSAT Alert Triggered**: CSAT dropped / low score alert. *(tenantId, window(daily|weekly|monthly), score, baseline?, delta?, threshold, triggeredAt, scopeType(agent|team|org), scopeId?)*

### Integrations (`packages/integrations`)

Sync lifecycle:

- `INTEGRATION_SYNC_STARTED` — **Integration Sync Started**: Sync job begins. *(tenantId, integrationId, provider, connectionId?, syncId, scope?, initiatedByUserId?, startedAt)*
- `INTEGRATION_SYNC_COMPLETED` — **Integration Sync Completed**: Sync finishes successfully. *(tenantId, integrationId, provider, connectionId?, syncId, startedAt, completedAt, durationMs, summary{created,updated,deleted,skipped}, warnings?)*
- `INTEGRATION_SYNC_FAILED` — **Integration Sync Failed**: Sync fails. *(tenantId, integrationId, provider, connectionId?, syncId, startedAt, failedAt, durationMs, errorCode?, errorMessage, retryable?)*
- `INTEGRATION_WEBHOOK_RECEIVED` — **Integration Webhook Received**: Webhook received. *(tenantId, integrationId, provider, connectionId?, webhookId, eventName, receivedAt, rawPayloadRef?)*

Auth/connection health:

- `INTEGRATION_CONNECTED` — **Integration Connected**: Connection established. *(tenantId, integrationId, provider, connectionId, connectedAt, connectedByUserId?)*
- `INTEGRATION_DISCONNECTED` — **Integration Disconnected**: Connection removed/invalidated. *(tenantId, integrationId, provider, connectionId, disconnectedAt, disconnectedByUserId?, reason?)*
- `INTEGRATION_TOKEN_EXPIRING` — **Integration Token Expiring**: OAuth token nearing expiration. *(tenantId, integrationId, provider, connectionId, expiresAt, daysUntilExpiry, notifiedAt)*
- `INTEGRATION_TOKEN_REFRESH_FAILED` — **Integration Token Refresh Failed**: Refresh failed. *(tenantId, integrationId, provider, connectionId, failedAt, errorCode?, errorMessage, retryable?)*

Mapping/config (useful for “fix my integrations” workflows):

- `EXTERNAL_MAPPING_CHANGED` — **External Mapping Changed**: External mapping updated (accounts/tax/service catalog). *(tenantId, provider, mappingType, mappingId, actorUserId, changedAt, previousValue?, newValue?)*

### Assets + Media (`packages/assets`, `packages/media`)

- `ASSET_CREATED` — **Asset Created**: Asset record created. *(tenantId, assetId, clientId?, createdByUserId, createdAt, assetType?, serialNumber?)*
- `ASSET_UPDATED` — **Asset Updated**: Asset fields changed. *(tenantId, assetId, updatedByUserId, updatedAt, updatedFields?, changes?)*
- `ASSET_ASSIGNED` — **Asset Assigned**: Asset assigned to client/contact/site. *(tenantId, assetId, previousOwnerType?, previousOwnerId?, newOwnerType, newOwnerId, actorUserId, assignedAt)*
- `ASSET_UNASSIGNED` — **Asset Unassigned**: Asset unassigned. *(tenantId, assetId, previousOwnerType, previousOwnerId, actorUserId, unassignedAt, reason?)*
- `ASSET_WARRANTY_EXPIRING` — **Asset Warranty Expiring**: Warranty approaching expiration. *(tenantId, assetId, expiresAt, daysUntilExpiry, clientId?)*

Media lifecycle:

- `FILE_UPLOADED` — **File Uploaded**: File uploaded to media pipeline. *(tenantId, fileId, uploadedByUserId, uploadedAt, fileName, contentType, sizeBytes, storageKey)*
- `MEDIA_PROCESSING_SUCCEEDED` — **Media Processing Succeeded**: Processing complete (thumbnails/virus scan). *(tenantId, fileId, processedAt, outputs?, durationMs)*
- `MEDIA_PROCESSING_FAILED` — **Media Processing Failed**: Processing failed. *(tenantId, fileId, failedAt, errorCode?, errorMessage, retryable?)*

