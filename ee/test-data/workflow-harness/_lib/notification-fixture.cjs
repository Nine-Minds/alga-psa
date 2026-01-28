const { randomUUID } = require('node:crypto');

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

async function pickUser(ctx, { tenantId, label } = {}) {
  return pickOne(ctx, {
    label: label ?? 'a user',
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId ?? ctx.config.tenantId]
  });
}

function buildMarker(fixtureName) {
  return `[fixture ${fixtureName}]`;
}

function buildBasePayloadForEvent({ eventName, correlationKey, userId }) {
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  switch (eventName) {
    // --- Tickets (domain expansion) ---
    case 'TICKET_CREATED':
    case 'TICKET_UPDATED':
    case 'TICKET_CLOSED':
      return { ticketId: correlationKey };
    case 'TICKET_STATUS_CHANGED':
      return { ticketId: correlationKey, previousStatusId: 'prev', newStatusId: 'new' };
    case 'TICKET_PRIORITY_CHANGED':
      return { ticketId: correlationKey, previousPriorityId: 'prev', newPriorityId: 'new' };
    case 'TICKET_ASSIGNED':
      return { ticketId: correlationKey };
    case 'TICKET_UNASSIGNED':
      return {
        ticketId: correlationKey,
        previousAssigneeId: randomUUID(),
        previousAssigneeType: 'user'
      };
    case 'TICKET_REOPENED':
      return { ticketId: correlationKey, previousStatusId: 'prev', newStatusId: 'new' };
    case 'TICKET_MERGED':
      return { sourceTicketId: correlationKey, targetTicketId: randomUUID() };
    case 'TICKET_SPLIT':
      return { originalTicketId: correlationKey, newTicketIds: [randomUUID()] };
    case 'TICKET_TAGS_CHANGED':
      return { ticketId: correlationKey, addedTagIds: [randomUUID()], removedTagIds: [randomUUID()] };
    case 'TICKET_QUEUE_CHANGED':
      return { ticketId: correlationKey, previousBoardId: randomUUID(), newBoardId: randomUUID() };
    case 'TICKET_ESCALATED':
      return { ticketId: correlationKey, fromQueueId: randomUUID(), toQueueId: randomUUID() };
    case 'TICKET_MESSAGE_ADDED':
      return {
        ticketId: correlationKey,
        messageId: randomUUID(),
        visibility: 'public',
        authorId: userId ?? randomUUID(),
        authorType: 'user',
        channel: 'api'
      };
    case 'TICKET_CUSTOMER_REPLIED':
      return {
        ticketId: correlationKey,
        messageId: randomUUID(),
        contactId: randomUUID(),
        channel: 'email'
      };
    case 'TICKET_INTERNAL_NOTE_ADDED':
      return { ticketId: correlationKey, noteId: randomUUID() };
    case 'TICKET_TIME_ENTRY_ADDED':
      return { ticketId: correlationKey, timeEntryId: randomUUID(), minutes: 15, billable: true };
    case 'TICKET_SLA_STAGE_ENTERED':
      return { ticketId: correlationKey, slaPolicyId: randomUUID(), stage: 'response' };
    case 'TICKET_SLA_STAGE_BREACHED':
      return { ticketId: correlationKey, slaPolicyId: randomUUID(), stage: 'custom' };
    case 'TICKET_RESPONSE_STATE_CHANGED':
      return { ticketId: correlationKey, previousResponseState: 'awaiting_client', newResponseState: 'awaiting_internal' };
    case 'TICKET_APPROVAL_REQUESTED':
      return { ticketId: correlationKey, approvalRequestId: randomUUID(), approvalType: 'standard' };
    case 'TICKET_APPROVAL_GRANTED':
      return { ticketId: correlationKey, approvalRequestId: randomUUID(), approvalType: 'standard' };
    case 'TICKET_APPROVAL_REJECTED':
      return { ticketId: correlationKey, approvalRequestId: randomUUID(), approvalType: 'standard' };

    // --- Tickets (legacy) ---
    case 'TICKET_COMMENT_ADDED':
      return { ticketId: correlationKey };
    case 'TICKET_ADDITIONAL_AGENT_ASSIGNED':
      return {
        ticketId: correlationKey,
        primaryAgentId: randomUUID(),
        additionalAgentId: randomUUID(),
        assignedByUserId: userId ?? randomUUID()
      };

    // --- Projects ---
    case 'PROJECT_CREATED':
    case 'PROJECT_UPDATED':
      return { projectId: correlationKey };
    case 'PROJECT_STATUS_CHANGED':
      return { projectId: correlationKey, previousStatus: 'prev', newStatus: 'new' };
    case 'PROJECT_ASSIGNED':
      return { projectId: correlationKey, assignedToId: userId ?? randomUUID(), assignedToType: 'user' };
    case 'PROJECT_CLOSED':
      return { projectId: correlationKey, closedByUserId: userId ?? randomUUID() };
    case 'PROJECT_TASK_CREATED':
      return { projectId: correlationKey, taskId: randomUUID(), title: 'Fixture task', status: 'open' };
    case 'PROJECT_TASK_ASSIGNED':
      return { projectId: correlationKey, taskId: randomUUID(), assignedToId: userId ?? randomUUID(), assignedToType: 'user' };
    case 'PROJECT_TASK_STATUS_CHANGED':
      return { projectId: correlationKey, taskId: randomUUID(), previousStatus: 'prev', newStatus: 'new' };
    case 'PROJECT_TASK_COMPLETED':
      return { projectId: correlationKey, taskId: randomUUID() };
    case 'PROJECT_TASK_DEPENDENCY_BLOCKED':
      return { projectId: correlationKey, taskId: randomUUID(), blockedByTaskId: randomUUID() };
    case 'PROJECT_TASK_DEPENDENCY_UNBLOCKED':
      return { projectId: correlationKey, taskId: randomUUID(), unblockedByTaskId: randomUUID() };
    case 'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED':
      return {
        projectId: correlationKey,
        taskId: randomUUID(),
        primaryAgentId: userId ?? randomUUID(),
        additionalAgentId: randomUUID(),
        assignedByUserId: userId ?? randomUUID()
      };
    case 'TASK_COMMENT_ADDED':
      return {
        projectId: correlationKey,
        taskId: randomUUID(),
        taskCommentId: randomUUID(),
        commentContent: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'fixture comment' }] }])
      };
    case 'TASK_COMMENT_UPDATED':
      return {
        projectId: correlationKey,
        taskId: randomUUID(),
        taskCommentId: randomUUID(),
        newCommentContent: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'fixture updated comment' }] }])
      };
    case 'PROJECT_APPROVAL_REQUESTED':
      return { projectId: correlationKey, approvalId: randomUUID(), approvalType: 'standard' };
    case 'PROJECT_APPROVAL_GRANTED':
      return { projectId: correlationKey, approvalId: randomUUID(), approvalType: 'standard' };
    case 'PROJECT_APPROVAL_REJECTED':
      return { projectId: correlationKey, approvalId: randomUUID(), approvalType: 'standard' };

    // --- Scheduling (domain expansion) ---
    case 'APPOINTMENT_CREATED':
      return { appointmentId: correlationKey, startAt: inOneHour, endAt: inTwoHours, timezone: 'UTC' };
    case 'APPOINTMENT_RESCHEDULED':
      return {
        appointmentId: correlationKey,
        previousStartAt: inOneHour,
        previousEndAt: inTwoHours,
        newStartAt: inOneHour,
        newEndAt: inTwoHours,
        timezone: 'UTC'
      };
    case 'APPOINTMENT_CANCELED':
      return { appointmentId: correlationKey };
    case 'APPOINTMENT_COMPLETED':
      return { appointmentId: correlationKey };
    case 'APPOINTMENT_NO_SHOW':
      return { appointmentId: correlationKey, party: 'customer' };
    case 'APPOINTMENT_ASSIGNED':
      return { appointmentId: correlationKey, newAssigneeId: userId ?? randomUUID(), newAssigneeType: 'user' };
    case 'SCHEDULE_BLOCK_DELETED':
      return { scheduleBlockId: correlationKey };
    case 'CAPACITY_THRESHOLD_REACHED':
      return { teamId: correlationKey, date: '2026-01-01', capacityLimit: 100, currentBooked: 101 };
    case 'TECHNICIAN_DISPATCHED':
      return { appointmentId: correlationKey, technicianUserId: userId ?? randomUUID() };
    case 'TECHNICIAN_EN_ROUTE':
      return { appointmentId: correlationKey, technicianUserId: userId ?? randomUUID() };
    case 'TECHNICIAN_ARRIVED':
      return { appointmentId: correlationKey, technicianUserId: userId ?? randomUUID() };
    case 'TECHNICIAN_CHECKED_OUT':
      return { appointmentId: correlationKey, technicianUserId: userId ?? randomUUID() };

    // --- Scheduling (legacy) ---
    case 'SCHEDULE_ENTRY_CREATED':
    case 'SCHEDULE_ENTRY_UPDATED':
    case 'SCHEDULE_ENTRY_DELETED':
      return { entryId: correlationKey, userId: userId ?? randomUUID(), changes: {} };
    case 'APPOINTMENT_REQUEST_CREATED':
    case 'APPOINTMENT_REQUEST_APPROVED':
    case 'APPOINTMENT_REQUEST_DECLINED':
    case 'APPOINTMENT_REQUEST_CANCELLED':
      return {
        appointmentRequestId: correlationKey,
        serviceId: randomUUID(),
        serviceName: 'Fixture service',
        requestedDate: '2026-01-01',
        requestedTime: '09:00',
        requestedDuration: 60,
        isAuthenticated: false,
        requesterEmail: 'fixture@example.com'
      };

    // --- Time (legacy) ---
    case 'TIME_ENTRY_SUBMITTED':
    case 'TIME_ENTRY_APPROVED':
      return { timeEntryId: correlationKey, userId: userId ?? randomUUID(), workItemId: randomUUID(), workItemType: 'TICKET' };

    // --- Billing ---
    case 'INVOICE_GENERATED':
    case 'INVOICE_FINALIZED':
      return { invoiceId: correlationKey };
    case 'INVOICE_SENT':
      return { invoiceId: correlationKey, deliveryMethod: 'email' };
    case 'INVOICE_STATUS_CHANGED':
      return { invoiceId: correlationKey, previousStatus: 'prev', newStatus: 'new' };
    case 'INVOICE_DUE_DATE_CHANGED':
      return { invoiceId: correlationKey, previousDueDate: '2026-01-01', newDueDate: '2026-01-02' };
    case 'INVOICE_OVERDUE':
      return { invoiceId: correlationKey, dueDate: '2026-01-01', amountDue: '1.00', currency: 'USD', daysOverdue: 1 };
    case 'INVOICE_WRITTEN_OFF':
      return { invoiceId: correlationKey, amountWrittenOff: '1.00', currency: 'USD' };
    case 'PAYMENT_APPLIED':
      return { paymentId: correlationKey, applications: [{ invoiceId: randomUUID(), amountApplied: '1.00' }] };
    case 'PAYMENT_FAILED':
      return { paymentId: correlationKey, amount: '1.00', currency: 'USD', method: 'card' };
    case 'CONTRACT_UPDATED':
      return { contractId: correlationKey, clientId: randomUUID() };
    case 'CONTRACT_STATUS_CHANGED':
      return { contractId: correlationKey, clientId: randomUUID(), previousStatus: 'prev', newStatus: 'new' };
    case 'CONTRACT_RENEWAL_UPCOMING':
      return { contractId: correlationKey, clientId: randomUUID(), renewalAt: '2026-12-31', daysUntilRenewal: 10 };

    // --- Companies ---
    case 'COMPANY_CREATED':
    case 'COMPANY_UPDATED':
      return { companyId: correlationKey };

    default:
      throw new Error(`Unsupported scaffolded eventName: ${eventName}`);
  }
}

async function assertRunSucceeded(ctx, runRow) {
  if (runRow.status === 'SUCCEEDED') return;
  const steps = await ctx.getRunSteps(runRow.run_id);
  throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
}

async function listNotifications(ctx, { tenantId, userId, limit = 50 }) {
  return ctx.db.query(
    `
      select internal_notification_id, title, message, template_name, is_read, created_at
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit ${Number(limit) || 50}
    `,
    [tenantId, userId]
  );
}

async function cleanupNotifications(ctx, { tenantId, userId, marker, dedupeKey }) {
  const titleLike = `%${marker}%`;
  const msgLike = `%${dedupeKey}%`;
  await ctx.dbWrite.query(
    `delete from internal_notifications where tenant = $1 and user_id = $2 and title like $3 and message like $4`,
    [tenantId, userId, titleLike, msgLike]
  );
}

async function triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload }) {
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName,
      correlationKey,
      payloadSchemaRef: schemaRef,
      payload
    }
  });
}

async function runDefault(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const marker = buildMarker(fixtureName);

  const user = await pickUser(ctx, { tenantId });
  const correlationKey = randomUUID();

  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: correlationKey
  };

  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));

  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  await assertRunSucceeded(ctx, runRow);

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id });
  const found = notifications.filter(
    (n) =>
      typeof n.title === 'string' &&
      n.title.includes(marker) &&
      typeof n.message === 'string' &&
      n.message.includes(correlationKey)
  );

  if (found.length < 1) {
    throw new Error(`Expected an internal notification containing "${marker}" and dedupeKey for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
}

async function runIdempotent(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const marker = buildMarker(fixtureName);

  const user = await pickUser(ctx, { tenantId });
  const correlationKey = randomUUID();

  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: correlationKey
  };

  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));

  // Trigger twice with the same dedupe key; action idempotency should prevent duplicates.
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow1 = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  await assertRunSucceeded(ctx, runRow1);

  const startedAfter2 = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow2 = await ctx.waitForRun({ startedAfter: startedAfter2 });
  await assertRunSucceeded(ctx, runRow2);

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id, limit: 200 });
  const found = notifications.filter(
    (n) =>
      typeof n.title === 'string' &&
      n.title.includes(marker) &&
      typeof n.message === 'string' &&
      n.message.includes(correlationKey)
  );

  if (found.length !== 1) {
    throw new Error(`Expected exactly 1 notification for "${marker}" with dedupeKey=${correlationKey}. Found ${found.length}.`);
  }
}

async function runForEach(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const marker = buildMarker(fixtureName);

  const user = await pickUser(ctx, { tenantId });
  const correlationKey = randomUUID();

  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: correlationKey
  };

  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));

  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  await assertRunSucceeded(ctx, runRow);

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id, limit: 200 });
  const found = notifications.filter(
    (n) =>
      typeof n.title === 'string' &&
      n.title.includes(marker) &&
      typeof n.message === 'string' &&
      n.message.includes(correlationKey)
  );

  if (found.length < 2) {
    throw new Error(`Expected at least 2 notifications containing "${marker}" and dedupeKey for user ${user.user_id}. Found ${found.length}.`);
  }
}

async function runTryCatch(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const marker = buildMarker(fixtureName);

  const user = await pickUser(ctx, { tenantId });
  const correlationKey = randomUUID();

  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureBadUserId: randomUUID(),
    fixtureDedupeKey: correlationKey
  };

  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));

  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  await assertRunSucceeded(ctx, runRow);

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id });
  const found = notifications.find(
    (n) =>
      typeof n.title === 'string' &&
      n.title.includes(marker) &&
      typeof n.title === 'string' &&
      n.title.includes('Fallback') &&
      typeof n.message === 'string' &&
      n.message.includes(correlationKey)
  );

  if (!found) {
    throw new Error(`Expected a fallback internal notification containing "${marker}" and dedupeKey for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
}

async function runMultiBranch(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const marker = buildMarker(fixtureName);

  const user = await pickUser(ctx, { tenantId });

  async function runVariant(variant) {
    const correlationKey = randomUUID();
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    const payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: correlationKey,
      fixtureVariant: variant
    };
    ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));
    await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
    const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
    await assertRunSucceeded(ctx, runRow);
    return correlationKey;
  }

  const a = await runVariant('A');
  const b = await runVariant('B');

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id, limit: 200 });
  const hasA = notifications.some(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && n.title.includes('Branch A') && typeof n.message === 'string' && n.message.includes(a)
  );
  const hasB = notifications.some(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && n.title.includes('Branch B') && typeof n.message === 'string' && n.message.includes(b)
  );

  if (!hasA || !hasB) {
    throw new Error(`Expected notifications for both Branch A and Branch B for "${marker}".`);
  }
}

async function runNotificationFixture(ctx, opts) {
  const { fixtureName, eventName, schemaRef, pattern = 'default' } = opts;
  if (!fixtureName || !eventName || !schemaRef) throw new Error('runNotificationFixture requires fixtureName, eventName, schemaRef');

  switch (pattern) {
    case 'default':
      return runDefault(ctx, { fixtureName, eventName, schemaRef });
    case 'idempotent':
      return runIdempotent(ctx, { fixtureName, eventName, schemaRef });
    case 'forEach':
      return runForEach(ctx, { fixtureName, eventName, schemaRef });
    case 'tryCatch':
      return runTryCatch(ctx, { fixtureName, eventName, schemaRef });
    case 'multiBranch':
      return runMultiBranch(ctx, { fixtureName, eventName, schemaRef });
    default:
      throw new Error(`Unknown fixture pattern: ${pattern}`);
  }
}

module.exports = {
  pickOne,
  pickUser,
  buildMarker,
  buildBasePayloadForEvent,
  runNotificationFixture,
};

