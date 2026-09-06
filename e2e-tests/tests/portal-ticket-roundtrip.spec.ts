import { test, expect, readSession, signIn, signInPortal } from '../fixtures/auth';

test('portal ticket survives assignment, replies, resolution and reopening without exposing internal notes or another client’s ticket', async ({ page, browser, baseURL, actors, credentials, database }) => {
  test.setTimeout(300_000);
  const tenant = actors.primary;
  const title = `Portal request ${actors.runId}`;
  const description = `Workstation cannot connect ${actors.runId}`;
  const reply = `Connection restored ${actors.runId}`;
  const internal = `Private diagnostic note ${actors.runId}`;
  const resolution = `Verified workstation connectivity ${actors.runId}`;

  await signInPortal(page, { email: tenant.portal.email, password: credentials.password }, tenant.tenantId);
  await page.goto('/client-portal/tickets');
  await page.locator('[data-automation-id="create-ticket-button"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-automation-id="client-ticket-title"]').fill(title);
  await dialog.locator('[contenteditable="true"]').fill(description);
  await dialog.locator('[data-automation-id="client-ticket-priority"]').click();
  await page.getByRole('option', { name: tenant.ticketing.priorityName, exact: true }).click();
  await dialog.locator('[data-automation-id="submit-ticket-button"]').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const tickets = await database('tickets').where({ tenant: tenant.tenantId, title });
  expect(tickets).toHaveLength(1);
  const ticket = tickets[0];
  expect(ticket).toMatchObject({ client_id: tenant.clients.primary.id, contact_name_id: tenant.portal.contactId,
    entered_by: tenant.portal.userId, board_id: tenant.ticketing.boardId, status_id: tenant.ticketing.openStatusId,
    priority_id: tenant.ticketing.priorityId, assigned_to: tenant.technician.userId });
  expect(ticket.ticket_number).toEqual(expect.any(String));
  const attributes = typeof ticket.attributes === 'string' ? JSON.parse(ticket.attributes) : ticket.attributes;
  expect(attributes.description).toContain(description);

  const staff = await browser.newContext({ baseURL });
  try {
    const staffPage = await staff.newPage();
    await signIn(staffPage, { email: tenant.technician.email, password: credentials.password });
    expect(await readSession(staff.request)).toMatchObject({ id: tenant.technician.userId, tenant: tenant.tenantId, user_type: 'internal' });
    await staffPage.goto(`/msp/tickets/${ticket.ticket_id}`);
    await expect(staffPage.getByText(description, { exact: true })).toBeVisible();
    const ticketWhere = { tenant: tenant.tenantId, ticket_id: ticket.ticket_id };
    await staffPage.locator('#ticket-details-bento-hero-assignee-picker').click();
    await staffPage.locator(`[data-automation-id$="-option-${tenant.admin.userId}"]`).click();
    await staffPage.locator('#ticket-details-bento-hero-save-changes-btn').click();
    await expect.poll(async () => (await database('tickets').where(ticketWhere).first())?.assigned_to).toBe(tenant.admin.userId);
    await staffPage.reload();
    await expect(staffPage.locator('#ticket-details-bento-hero-assignee-picker')).toContainText('primary admin');
    const conversation = staffPage.locator('#ticket-details-bento-timeline-tile');
    for (const [text, isInternal] of [[reply, false], [internal, true]] as const) {
      await conversation.getByRole('button', { name: 'Add Comment', exact: true }).click();
      const visibility = conversation.getByRole('group', { name: 'Reply visibility' });
      const lane = visibility.getByRole('button', { name: isInternal ? 'Internal' : 'Client', exact: true });
      await lane.click();
      await expect(lane).toHaveAttribute('aria-pressed', 'true');
      await conversation.locator('[contenteditable="true"]:visible').fill(text);
      await conversation.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(conversation.getByRole('button', { name: 'Add Comment', exact: true })).toBeVisible();
      await expect(conversation.getByText(text, { exact: true })).toBeVisible();
    }
    await staffPage.reload();
    await expect(staffPage.getByText(reply, { exact: true })).toBeVisible();
    await expect(staffPage.getByText(internal, { exact: true })).toBeVisible();
    const notes = await database('comments').where({ tenant: tenant.tenantId, ticket_id: ticket.ticket_id });
    for (const [text, isInternal] of [[reply, false], [internal, true]] as const) {
      expect(notes.filter(note => note.note?.includes(text)))
        .toEqual([expect.objectContaining({ user_id: tenant.technician.userId, is_internal: isInternal })]);
    }

    await staffPage.locator('#ticket-details-bento-hero-resolve-and-close-button').click();
    const closeDialog = staffPage.getByRole('dialog', { name: 'Close ticket', exact: true });
    await closeDialog.locator('[contenteditable="true"]').fill(resolution);
    await closeDialog.getByRole('button', { name: 'Resolve and close', exact: true }).click();
    await expect(closeDialog).toBeHidden();
    await expect.poll(async () => (await database('tickets').where(ticketWhere).first())?.status_id).toBe(tenant.ticketing.closedStatusId);
    await staffPage.reload();
    await expect(staffPage.locator('#ticket-details-bento-hero-status-select')).toContainText('Closed');
    const closedTicket = await database('tickets').where(ticketWhere).first();
    expect(closedTicket.closed_at).not.toBeNull();
    expect(closedTicket.closed_by).toBe(tenant.technician.userId);
    expect((await database('comments').where(ticketWhere)).filter(note => note.note?.includes(resolution)))
      .toEqual([expect.objectContaining({ user_id: tenant.technician.userId, is_resolution: true, is_internal: false })]);

    await staffPage.locator('#ticket-details-bento-hero-status-select').click();
    await staffPage.getByRole('option', { name: 'Open', exact: true }).click();
    await staffPage.locator('#ticket-details-bento-hero-save-changes-btn').click();
    await expect.poll(async () => (await database('tickets').where(ticketWhere).first())?.status_id).toBe(tenant.ticketing.openStatusId);
    await staffPage.reload();
    await expect(staffPage.locator('#ticket-details-bento-hero-status-select')).toContainText('Open');
    expect(await database('tickets').where(ticketWhere).first()).toMatchObject({ closed_at: null, closed_by: null, assigned_to: tenant.admin.userId });
    for (const text of [reply, internal, resolution]) await expect(staffPage.getByText(text, { exact: true })).toBeVisible();
  } finally { await staff.close(); }

  await page.goto(`/client-portal/tickets/${ticket.ticket_id}`);
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await expect(page.getByText(resolution, { exact: true })).toBeVisible();
  await expect(page.getByText(internal, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await expect(page.getByText(internal, { exact: true })).toHaveCount(0);

  for (const actor of [tenant.siblingPortal, actors.secondary.portal]) {
    const unrelated = await browser.newContext({ baseURL });
    try {
      const unrelatedPage = await unrelated.newPage();
      await signInPortal(unrelatedPage, { email: actor.email, password: credentials.password }, actor.tenantId);
      expect(await readSession(unrelated.request)).toMatchObject({ id: actor.userId, tenant: actor.tenantId });
      await unrelatedPage.goto('/client-portal/tickets');
      await expect(unrelatedPage.getByText(title, { exact: true })).toHaveCount(0);
      await unrelatedPage.goto(`/client-portal/tickets/${ticket.ticket_id}`);
      await expect(unrelatedPage.locator('#ticket-error-message')).toContainText('Ticket not found or access denied');
      for (const text of [title, description, reply, internal, resolution]) {
        await expect(unrelatedPage.getByText(text, { exact: true })).toHaveCount(0);
      }
    } finally { await unrelated.close(); }
  }
});
