# Email Template Variable Reference

<!-- Generated from the template variable registry. Do not edit by hand. Regenerate with: npx tsx packages/notifications/scripts/generate-variable-docs.ts --output=docs/email/template-variable-reference.md -->

Every variable each AlgaPSA system email template can use, with its type, meaning, and an example value. It is the same list the in-app **Variable reference** searches, laid out one table per template.

The customer-facing guide is in the website docs: [Customize Email Templates with Variables](https://www.nineminds.com/documentation/email-template-variables).

## How to read this reference

- Each section is one area, and each table is one system template, named as the in-app reference shows it under **Used by**.
- A variable works only in the templates that list it. An invoice variable is empty in a ticket email.
- Ordinary values use double braces, such as `{{ticket.title}}`. Variables of type `raw-html` use triple braces, such as `{{{ticket.changes}}}`, because their value is markup prepared by AlgaPSA.
- A template marked **Not currently sent** can be customized, but AlgaPSA does not dispatch that email today.

## Appointments

### appointment-request-received

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{serviceName}}` | string | Name of the requested service. | `Network Assessment` |
| `{{requesterName}}` | string | Name of the person who submitted the request; greeting is generic if absent. | `Jane Smith` |
| `{{referenceNumber}}` | string | Short reference code for the request the customer can quote when following up. | `APT-LZ3K9-QX7A` |
| `{{requestedDate}}` | string | The date the customer asked for, pre-formatted. | `Monday, July 21, 2026` |
| `{{requestedTime}}` | string | The time the customer asked for, pre-formatted with a parenthesized timezone label. | `2:00 PM (EDT)` |
| `{{duration}}` | number | Requested appointment length in minutes (label 'minutes' is appended by the template). | `60` |
| `{{preferredTechnician}}` | string | Technician the customer requested by preference, if any. | `John Doe` |
| `{{responseTime}}` | string | Typical turnaround the MSP promises before responding to the request. | `24 hours` |
| `{{contactEmail}}` | string | Support email address the customer can reach out to. | `support@acme-it.com` |
| `{{contactPhone}}` | string | Support phone number, shown only when provided. | `+1 (555) 010-1234` |
| `{{requesterEmail}}` | string | Email address of the requester (used as the send-to address). | `jane.smith@client.com` |
| `{{portalLink}}` | string | URL to the client portal appointments area. | `https://app.algapsa.com/client-portal/appointments` |

### appointment-request-approved

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{serviceName}}` | string | Name of the confirmed service. | `Network Assessment` |
| `{{appointmentDate}}` | string | Confirmed appointment date, pre-formatted. | `Monday, July 21, 2026` |
| `{{appointmentTime}}` | string | Confirmed appointment time, pre-formatted. | `2:00 PM EDT` |
| `{{duration}}` | number | Confirmed appointment length in minutes. | `60` |
| `{{requesterName}}` | string | Name of the customer; greeting is generic if absent. | `Jane Smith` |
| `{{technicianName}}` | string | Name of the technician assigned to the appointment (first_name + last_name). | `John Doe` |
| `{{technicianEmail}}` | string | Assigned technician's email address. | `john.doe@acme-it.com` |
| `{{technicianPhone}}` | string | Assigned technician's phone number. | `+1 (555) 010-5678` |
| `{{onlineMeetingUrl}}` | url | Microsoft Teams join link when the appointment is an online meeting. | `https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123` |
| `{{calendarLink}}` | url | Link to download the appointment as an ICS calendar file. | `https://app.algapsa.com/api/appointments/ics/abc123` |
| `{{cancellationPolicy}}` | string | Cancellation policy text shown in a highlighted box. | `Please cancel at least 24 hours in advance.` |
| `{{minimumNoticeHours}}` | number | Minimum advance notice (hours) required to reschedule or cancel. | `24` |
| `{{contactEmail}}` | string | Support email for reschedule/cancel requests. | `support@acme-it.com` |
| `{{contactPhone}}` | string | Support phone number, shown only when provided. | `+1 (555) 010-1234` |
| `{{requesterEmail}}` | string | Customer's email address (used as the send-to address). | `jane.smith@client.com` |

### appointment-request-declined

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{serviceName}}` | string | Name of the service originally requested. | `Network Assessment` |
| `{{requesterName}}` | string | Name of the customer; greeting is generic if absent. | `Jane Smith` |
| `{{requestedDate}}` | string | The date the customer had requested, pre-formatted. | `Monday, July 21, 2026` |
| `{{requestedTime}}` | string | The time the customer had requested, pre-formatted. | `2:00 PM EDT` |
| `{{referenceNumber}}` | string | Reference code for the original request. | `A1B2C3D4` |
| `{{declineReason}}` | string | Optional explanation of why the request could not be accommodated. | `The requested time is fully booked.` |
| `{{requestNewAppointmentLink}}` | url | Link where the customer can submit a new appointment request. | `https://app.algapsa.com/client-portal/appointments/new` |
| `{{contactEmail}}` | string | Support email for help finding an available time. | `support@acme-it.com` |
| `{{contactPhone}}` | string | Support phone number, shown only when provided. | `+1 (555) 010-1234` |
| `{{requesterEmail}}` | string | Customer's email address (used as the send-to address). | `jane.smith@client.com` |

### appointment-assigned-technician

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{technicianName}}` | string | Name of the technician being notified of their new assignment (first_name + last_name). | `John Doe` |
| `{{serviceName}}` | string | Name of the service for the assigned appointment. | `Network Assessment` |
| `{{appointmentDate}}` | string | Assigned appointment date, pre-formatted. | `Monday, July 21, 2026` |
| `{{appointmentTime}}` | string | Assigned appointment time, pre-formatted (technician timezone). | `2:00 PM EDT` |
| `{{duration}}` | number | Assigned appointment length in minutes. | `60` |
| `{{clientName}}` | string | Name of the client the appointment is for (client_name, falling back to the requester name). | `Acme Corporation` |
| `{{description}}` | string | Appointment notes for the technician. | `Customer reports intermittent VPN drops; bring spare firewall.` |
| `{{onlineMeetingUrl}}` | url | Microsoft Teams join link when the appointment is an online meeting. | `https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123` |
| `{{calendarLink}}` | url | Link to download the appointment as an ICS calendar file. | `https://app.algapsa.com/api/appointments/ics/abc123` |
| `{{contactEmail}}` | string | Internal support/contact email for questions about the assignment. | `dispatch@acme-it.com` |
| `{{contactPhone}}` | string | Contact phone number, shown only when provided. | `+1 (555) 010-1234` |
| `{{technicianEmail}}` | string | Assigned technician's email address (used as the send-to address). | `john.doe@acme-it.com` |

### new-appointment-request

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{clientName}}` | string | Name of the client the request is associated with; also used in the subject and header. | `Acme Corporation` |
| `{{serviceName}}` | string | Name of the requested service. | `Network Assessment` |
| `{{requesterName}}` | string | Name of the person who submitted the request. | `Jane Smith` |
| `{{requesterEmail}}` | string | Email address of the requester. | `jane.smith@client.com` |
| `{{requesterPhone}}` | string | Phone number of the requester, shown only when provided. | `+1 (555) 010-1234` |
| `{{companyName}}` | string | Company the requester belongs to, shown only when provided. | `Acme Corporation` |
| `{{referenceNumber}}` | string | Reference code for the new request. | `A1B2C3D4` |
| `{{requestedDate}}` | string | The date the customer requested, pre-formatted. | `Monday, July 21, 2026` |
| `{{requestedTime}}` | string | The time the customer requested, pre-formatted with a parenthesized staff-timezone label. | `2:00 PM (EDT)` |
| `{{duration}}` | number | Requested appointment length in minutes. | `60` |
| `{{preferredTechnician}}` | string | Technician the customer requested by preference; defaults to 'Not specified'. | `John Doe` |
| `{{description}}` | string | Additional notes the customer provided with the request. | `Prefer morning; two workstations affected.` |
| `{{approvalLink}}` | url | Deep link that opens this request in the schedule page's Appointment Requests panel so MSP staff can review and approve it. | `https://app.algapsa.com/msp/schedule?requestId=3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64` |
| `{{submittedAt}}` | string | Timestamp when the request was submitted. | `2026-07-17T14:03:00.000Z` |
| `{{linkedTicket}}` | string | Reference to a ticket linked to the request, if any. | `TCK-1234` |
| `{{isAuthenticated}}` | boolean | Whether the request came from a signed-in client-portal user (true) or a public form (false). | `true` |
| `{{portalLink}}` | url | URL to the relevant portal area. | `https://app.algapsa.com/msp/schedule` |
| `{{contactEmail}}` | string | Support/contact email address. | `support@acme-it.com` |
| `{{contactPhone}}` | string | Support/contact phone number. | `+1 (555) 010-1234` |

## Authentication

### email-verification

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{registrationClientName}}` | string | Name of the client/company the person is registering for; shown in the subject and intro when present. | `Acme Corporation` |
| `{{verificationUrl}}` | url | The link the recipient clicks to verify their email address and activate the account. | `https://app.example.com/auth/verify?token=sample-token&registrationId=reg-789` |
| `{{tenantClientName}}` | string | The service provider (MSP tenant) name shown in the copyright footer. | `Wolf River IT` |
| `{{currentYear}}` | number | The current calendar year, shown in the copyright footer. | `2026` |
| `{{expirationTime}}` | string | Human-readable window before the verification link expires (drives a time-sensitive warning box). | `48 hours` |
| `{{email}}` | string | The recipient's email address being verified. | `jane.doe@acme.com` |

### no-account-found

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{platformName}}` | string | The portal/product name shown in the subject, header banner, and footer. | `Client Portal` |
| `{{currentYear}}` | number | The current calendar year, shown in the copyright footer. | `2026` |

### password-reset

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{userName}}` | string | The recipient's display name, used in the greeting line. | `John Doe` |
| `{{email}}` | string | The account email the password reset applies to; shown in the intro, the security-check box, and the footer. | `john.doe@example.com` |
| `{{resetLink}}` | url | The link the recipient clicks to set a new password. | `https://app.example.com/auth/reset-password?token=sample-token` |
| `{{expirationTime}}` | string | Human-readable window before the reset link expires (e.g. valid-for and warning copy). | `24 hours` |
| `{{supportEmail}}` | string | Support contact email shown in the Need Help section (also set as the email Reply-To). | `support@example.com` |
| `{{clientName}}` | string | The organization name shown in the copyright footer. | `Acme Corporation` |
| `{{currentYear}}` | number | The current calendar year, shown in the copyright footer. | `2026` |

### portal-invitation

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{contactName}}` | string | The invited contact's name, used in the greeting and footer. | `Jane Smith` |
| `{{clientName}}` | string | The recipient's own client company, named in the invitation intro. | `Acme Corporation` |
| `{{tenantName}}` | string | The MSP sending the invitation, shown in the subject and footer copyright. | `Northwind Managed Services` |
| `{{portalLink}}` | url | The link the recipient clicks to set up their portal access. | `https://app.example.com/auth/accept-invite?token=sample-token` |
| `{{expirationTime}}` | string | Human-readable window before the invitation link expires. | `7 days` |
| `{{supportEmail}}` | string | The MSP's support email, shown in the Need Assistance box and footer (also the email Reply-To). | `support@northwind.example` |
| `{{supportPhone}}` | string | The MSP's support phone number, shown in the Need Assistance box. | `+1 (555) 010-1234` |
| `{{clientLocationEmail}}` | string | Legacy alias of supportEmail, kept for template rows that predate the rename. | `support@northwind.example` |
| `{{clientLocationPhone}}` | string | Legacy alias of supportPhone, kept for template rows that predate the rename. | `+1 (555) 010-1234` |
| `{{currentYear}}` | number | The current calendar year, shown in the copyright footer. | `2026` |

### tenant-recovery

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{platformName}}` | string | The portal/product name shown in the subject, header banner, and footer. | `Client Portal` |
| `{{isMultiple}}` | boolean | Whether the recipient's email is associated with more than one organization; toggles singular vs plural wording. | `true` |
| `{{tenantCount}}` | number | How many organizations were found for the recipient's email address. | `3` |
| `{{{tenantLinksHtml}}}` | raw-html | Pre-rendered HTML table rows, one per organization, each with the org name and a Sign In button. | `<tr><td>...Sign In to Acme Corporation...</td></tr>` |
| `{{tenantLinksText}}` | string | Plain-text list of organizations and their login URLs, for the text version of the email. | `1. Acme Corporation    Login URL: https://acme.portal.example.com/login` |
| `{{currentYear}}` | number | The current calendar year, shown in the copyright footer. | `2026` |

## Billing

### credit-expiring

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{client.name}}` | string | The name of the client whose credits are expiring. | `Acme Corporation` |
| `{{client.id}}` | string | Internal identifier of the client whose credits are expiring. | `client-001` |
| `{{credits.totalAmount}}` | string | The total value of all credits that are about to expire, pre-formatted as currency. | `$2,500.00` |
| `{{credits.expirationDate}}` | string | The date the credits expire, pre-formatted for display. | `March 31, 2026` |
| `{{credits.daysRemaining}}` | number | How many days remain until the credits expire. | `30` |
| `{{credits.items}}` | array | The line-by-line list of individual credits that are expiring, shown as a table. | `[{ creditId: 'CR-1001', amount: '$1,500.00', expirationDate: 'March 31, 2026', transactionId: 'TX-9001' }]` |
| `{{credits.items.creditId}}` | string | Identifier of an individual expiring credit. | `CR-1001` |
| `{{credits.items.amount}}` | string | The value of an individual expiring credit, pre-formatted as currency. | `$1,500.00` |
| `{{credits.items.expirationDate}}` | string | The expiration date of an individual credit, pre-formatted for display. | `March 31, 2026` |
| `{{credits.items.transactionId}}` | string | Identifier of the original transaction that created this credit. | `TX-9001` |
| `{{credits.items.description}}` | string | Human-readable description of the original transaction that created the credit. | `Overpayment refund on invoice INV-2043` |
| `{{credits.url}}` | url | Link to the client's credits page in the app where the expiring credits can be viewed and used. | `https://app.example.com/billing/credits?client=client-001` |

## Invoices

### invoice-email

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{invoice.number}}` | string | The invoice's human-readable number as shown to the client. | `INV-000123` |
| `{{invoice.amount}}` | string | Total amount due on the invoice, pre-formatted as a currency string. | `$1,250.00` |
| `{{invoice.invoiceDate}}` | date | The date the invoice was issued, formatted for display. | `July 10, 2026` |
| `{{invoice.dueDate}}` | date | The date payment is due, formatted for display. | `August 9, 2026` |
| `{{recipient.name}}` | string | Name of the person the invoice email is addressed to (billing contact or client). | `Jane Smith` |
| `{{company.name}}` | string | The MSP's own company name, shown as the sender in subject, intro, and signature. | `Contoso IT Services` |
| `{{customMessage}}` | string | Optional free-text note from the MSP shown in a highlighted box; the box is hidden when empty. | `Thanks for your continued business — please note our new remittance address.` |
| `{{recipient.email}}` | string | Email address the invoice is being sent to. | `jane.smith@acme.com` |
| `{{client.name}}` | string | The client (customer) company being billed. | `Acme Corporation` |
| `{{invoice.paymentUrl}}` | url | Hosted Stripe Checkout URL for the invoice, present only when payments are enabled and a link could be created. | `https://checkout.stripe.com/c/pay/cs_test_xyz` |
| `{{invoice.portalUrl}}` | url | Authenticated client-portal billing URL (invoices tab) for the invoice, present when a public portal base is available. | `https://app.algapsa.com/client-portal/billing?tab=invoices&invoiceId=inv-001` |

### invoice-generated

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{invoice.number}}` | string | The newly generated invoice's number. | `INV-000123` |
| `{{invoice.amount}}` | string | Invoice total, expected as a pre-formatted currency string. | `$1,250.00` |
| `{{invoice.dueDate}}` | date | Date the invoice payment is due, formatted for display. | `August 9, 2026` |
| `{{invoice.clientName}}` | string | The client the invoice was generated for. | `Acme Corporation` |
| `{{invoice.url}}` | url | Link to view the invoice in the app; target of the 'View Invoice' button. | `https://app.example.com/msp/billing/invoices/inv-001` |

### payment-overdue

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{invoice.number}}` | string | The overdue invoice's number. | `INV-000123` |
| `{{invoice.clientName}}` | string | The client whose payment is overdue. | `Acme Corporation` |
| `{{invoice.amountDue}}` | string | Outstanding amount still owed, expected as a pre-formatted currency string. | `$1,250.00` |
| `{{invoice.dueDate}}` | date | Date the payment was originally due. | `July 1, 2026` |
| `{{invoice.daysOverdue}}` | number | How many days past the due date the invoice is. | `14` |
| `{{invoice.url}}` | url | Link to view the invoice in the app; target of the 'View Invoice' button. | `https://app.example.com/msp/billing/invoices/inv-001` |

### payment-received

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{invoice.number}}` | string | The invoice the payment was applied to. | `INV-000123` |
| `{{invoice.clientName}}` | string | The client who made the payment. | `Acme Corporation` |
| `{{invoice.amountPaid}}` | string | Amount received, expected as a pre-formatted currency string. | `$1,250.00` |
| `{{invoice.paymentDate}}` | date | Date the payment was received. | `July 15, 2026` |
| `{{invoice.paymentMethod}}` | string | How the payment was made. | `Credit Card` |
| `{{invoice.url}}` | url | Link to view the invoice in the app; target of the 'View Invoice' button. | `https://app.example.com/msp/billing/invoices/inv-001` |

## Opportunities

### opportunity-weekly-digest

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{digest.actionsDue}}` | number | How many open opportunities owned by this rep have a next-action date falling within the current week | `4` |
| `{{digest.stalledDeals}}` | number | How many of this rep's open opportunities have gone untouched past the configured nudge window (last_activity_at at or before the stalled cutoff) | `2` |
| `{{digest.newSuggestions}}` | number | Count of pending opportunity_suggestions created since the start of last week (no upper bound, so it spans roughly one-to-two weeks up to now); tenant-wide, the same value for every recipient | `5` |
| `{{digest.winsLastWeek}}` | number | How many of this rep's opportunities were marked won during the previous week (won_at within [startOfLastWeek, startOfThisWeek)) | `1` |
| `{{digest.url}}` | url | Deep link to the rep's opportunity queue in the app | `https://app.example.com/msp/opportunities` |

## Projects

### milestone-completed

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{milestone.name}}` | string | Name of the project milestone that was completed | `Phase 1 Sign-off` |
| `{{milestone.completedDate}}` | date | Date the milestone was marked complete | `Jul 15, 2026` |
| `{{milestone.completedBy}}` | string | Name of the person who completed the milestone | `John Doe` |
| `{{project.name}}` | string | Name of the project the milestone belongs to | `Q2 Rollout` |
| `{{project.progress}}` | number | Overall project completion percentage (rendered with a trailing % sign) | `65` |
| `{{project.url}}` | url | Link to open the project | `https://app.example.com/msp/projects/sample-project-id` |

### project-assigned

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{project.name}}` | string | Name of the project the recipient was assigned to | `Q2 Rollout` |
| `{{project.description}}` | string | Plain-text project description (BlockNote content flattened to text via formatBlockNoteContent) | `Roll out new endpoint protection to all client sites.` |
| `{{project.startDate}}` | date | Project start date (projects.start_date; raw DB value, not pre-formatted) | `2026-05-01` |
| `{{project.assignedBy}}` | string | Name of the person who assigned the project, resolved from the assigner user's first+last name (falls back to 'Someone') | `John Doe` |
| `{{project.url}}` | url | MSP link to open the assigned project (always the internal /msp/projects URL — this handler does not build a client-portal variant) | `https://app.example.com/msp/projects/sample-project-id` |
| `{{project.descriptionText}}` | string | Plain-text project description (same value as project.description) | `Roll out new endpoint protection to all client sites.` |
| `{{project.descriptionHtml}}` | string | HTML-rendered project description | `<p>Roll out new endpoint protection to all client sites.</p>` |
| `{{project.client}}` | string | Name of the client the project belongs to (falls back to 'No Client') | `Acme Corporation` |

### project-closed

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{project.name}}` | string | Name of the closed project | `Q2 Rollout` |
| `{{project.status}}` | string | Current status label of the project (falls back to 'Unknown') | `Closed` |
| `{{project.closedBy}}` | string | Name of the person who closed the project (resolved from the actor user id via resolveValue; falls back to the raw id/'None') | `John Doe` |
| `{{{project.changes}}}` | raw-html | Pre-rendered HTML fragment listing the field changes applied when closing (rendered raw via triple-stache in HTML, and as plain text in the text body) | `<ul style="margin:0;padding:0;list-style:none;">...</ul>` |
| `{{project.changeItems}}` | array | The field changes in this email, one item per field, laid out by the template's 'Changes Made' box. The template owns all colors, so email branding restyles it. | `[{ label: 'Status', oldValue: 'In Progress', newValue: 'Completed' }]` |
| `{{project.changeItems.label}}` | string | Display name of the changed field. | `Status` |
| `{{project.changeItems.oldValue}}` | string | The field's previous value, resolved to a display name. Empty when the change has no previous value; wrap it in {{#if this.oldValue}}. | `In Progress` |
| `{{project.changeItems.newValue}}` | string | The field's new value, resolved to a display name. | `Completed` |
| `{{project.url}}` | url | Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user) | `https://app.example.com/msp/projects/sample-project-id` |
| `{{project.id}}` | string | Human-readable project number (projects.project_number) | `PRJ-0042` |
| `{{project.manager}}` | string | Name of the project manager (falls back to 'Unassigned') | `Jane Smith` |
| `{{project.description}}` | string | Plain-text project description | `Roll out new endpoint protection to all client sites.` |
| `{{project.descriptionText}}` | string | Plain-text project description (same value as project.description) | `Roll out new endpoint protection to all client sites.` |
| `{{project.descriptionHtml}}` | string | HTML-rendered project description | `<p>Roll out new endpoint protection to all client sites.</p>` |
| `{{project.startDate}}` | date | Project start date | `2026-05-01` |
| `{{project.endDate}}` | date | Project end date | `2026-07-15` |
| `{{project.closedAt}}` | date | ISO timestamp when the project was closed (new Date().toISOString() at send time) | `2026-07-17T14:30:00.000Z` |
| `{{project.client}}` | string | Name of the client the project belongs to (falls back to 'No Client') | `Acme Corporation` |

### project-created

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{project.name}}` | string | Name of the newly created project | `Q2 Rollout` |
| `{{project.description}}` | string | Plain-text project description (BlockNote content flattened to text) | `Roll out new endpoint protection to all client sites.` |
| `{{project.startDate}}` | date | Project start date | `2026-05-01` |
| `{{project.manager}}` | string | Name of the project manager (falls back to 'Unassigned') | `Jane Smith` |
| `{{project.url}}` | url | Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user) | `https://app.example.com/msp/projects/sample-project-id` |
| `{{project.id}}` | string | Human-readable project number (projects.project_number) | `PRJ-0042` |
| `{{project.descriptionText}}` | string | Plain-text project description (same value as project.description) | `Roll out new endpoint protection to all client sites.` |
| `{{project.descriptionHtml}}` | string | HTML-rendered project description | `<p>Roll out new endpoint protection to all client sites.</p>` |
| `{{project.status}}` | string | Current status label of the project (falls back to 'Unknown') | `Planning` |
| `{{project.endDate}}` | date | Project end date | `2026-07-15` |
| `{{project.createdBy}}` | string | User ID of the actor who created the project (raw ID, not a display name) | `user-123` |
| `{{project.client}}` | string | Name of the client the project belongs to (falls back to 'No Client') | `Acme Corporation` |

### project-task-assigned-additional

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{task.name}}` | string | Name of the task the recipient was added to | `Configure firewall rules` |
| `{{task.project}}` | string | Name of the project the task belongs to | `Q2 Rollout` |
| `{{task.dueDate}}` | date | Task due date (project_tasks.due_date; row only shown when present) | `2026-06-30` |
| `{{task.assignedBy}}` | string | Name of the person who assigned the task, from the event payload assignedByName (falls back to 'Someone'); row only shown when present | `John Doe` |
| `{{task.role}}` | string | Recipient's role on the task; set to 'Additional Agent' at send time (row only shown when present) | `Additional Agent` |
| `{{task.url}}` | url | MSP link to open the task within the project view | `https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1` |
| `{{task.description}}` | string | Task description shown in a highlighted box when present; referenced by the template but NOT supplied by the send-time context, so it always renders empty/omitted | `Apply the standard firewall baseline to all edge devices.` |
| `{{recipientName}}` | string | Recipient's display name used in the greeting when present; referenced by the template but NOT supplied by the send-time context, so the greeting renders without a name | `Jane Smith` |

### project-task-assigned-primary

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{task.name}}` | string | Name of the task the recipient was assigned to | `Configure firewall rules` |
| `{{task.project}}` | string | Name of the project the task belongs to | `Q2 Rollout` |
| `{{task.dueDate}}` | date | Task due date (project_tasks.due_date; row only shown when present) | `2026-06-30` |
| `{{task.assignedBy}}` | string | Name of the person who assigned the task, from the event payload assignedByName (falls back to 'Someone'); row only shown when present | `John Doe` |
| `{{task.role}}` | string | Recipient's role on the task; set to 'Primary Assignee' at send time (row only shown when present) | `Primary Assignee` |
| `{{task.url}}` | url | MSP link to open the task within the project view | `https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1` |
| `{{task.description}}` | string | Task description shown in a highlighted box when present; referenced by the template but NOT supplied by the send-time context, so it always renders empty/omitted | `Apply the standard firewall baseline to all edge devices.` |
| `{{recipientName}}` | string | Recipient's display name used in the greeting when present; referenced by the template but NOT supplied by the send-time context, so the greeting renders without a name | `Jane Smith` |

### project-updated

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{project.name}}` | string | Name of the updated project | `Q2 Rollout` |
| `{{project.status}}` | string | Current status label of the project (falls back to 'Unknown') | `In Progress` |
| `{{project.updatedBy}}` | string | Name of the person who updated the project (resolved from the actor user; falls back to the raw user ID) | `John Doe` |
| `{{{project.changes}}}` | raw-html | Pre-rendered HTML fragment listing the field changes (old vs new values); rendered raw via triple-stache in HTML and as plain text in the text body | `<ul style="margin:0;padding:0;list-style:none;">...</ul>` |
| `{{project.changeItems}}` | array | The field changes in this email, one item per field, laid out by the template's 'Changes Made' box. The template owns all colors, so email branding restyles it. | `[{ label: 'Status', oldValue: 'Planning', newValue: 'In Progress' }]` |
| `{{project.changeItems.label}}` | string | Display name of the changed field. | `Status` |
| `{{project.changeItems.oldValue}}` | string | The field's previous value, resolved to a display name. Empty when the change has no previous value; wrap it in {{#if this.oldValue}}. | `Planning` |
| `{{project.changeItems.newValue}}` | string | The field's new value, resolved to a display name. | `In Progress` |
| `{{project.url}}` | url | Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user) | `https://app.example.com/msp/projects/sample-project-id` |
| `{{project.id}}` | string | Human-readable project number (projects.project_number) | `PRJ-0042` |
| `{{project.manager}}` | string | Name of the project manager (falls back to 'Unassigned') | `Jane Smith` |
| `{{project.client}}` | string | Name of the client the project belongs to (falls back to 'No Client') | `Acme Corporation` |

### task-comment-added

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{task.name}}` | string | Name of the task the comment was added to | `Configure firewall rules` |
| `{{task.url}}` | url | MSP link to open the task within the project view | `https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1` |
| `{{project.name}}` | string | Name of the project the task belongs to | `Q2 Rollout` |
| `{{comment.author}}` | string | Display name of the person who wrote the comment (falls back to 'Someone') | `John Doe` |
| `{{{comment.contentHtml}}}` | raw-html | HTML-rendered comment body (rendered raw via triple-stache in the HTML email) | `<p>I have completed the firewall config, please review.</p>` |
| `{{comment.contentText}}` | string | Plain-text comment body used in the text email | `I have completed the firewall config, please review.` |

### task-updated

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{task.name}}` | string | Name of the updated task | `Configure firewall rules` |
| `{{task.status}}` | string | Current status label of the task | `In Progress` |
| `{{task.progress}}` | number | Task completion percentage (rendered with a trailing % sign) | `50` |
| `{{task.updatedBy}}` | string | Name of the person who updated the task | `John Doe` |
| `{{task.url}}` | url | Link to open the task | `https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1` |
| `{{project.name}}` | string | Name of the project the task belongs to | `Q2 Rollout` |

## Quotes

### quote-email

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{quote.number}}` | string | The quote's human-readable number as shown to the client. | `Q-0042` |
| `{{quote.amount}}` | string | Total value of the quote, pre-formatted as a currency string. | `$10,000.00` |
| `{{quote.validUntil}}` | date | The date the quote expires, formatted for display. | `March 31, 2026` |
| `{{company.name}}` | string | The MSP's own company name, shown as the sender in the subject, intro, and signature. | `Contoso IT Services` |
| `{{portalLink}}` | url | Link to the client-portal quotes tab where the quote can be reviewed; the block is hidden when empty. | `https://app.example.com/client-portal/billing?tab=quotes` |
| `{{quoteReviewLink}}` | url | Per-recipient link to review and approve the quote without signing in; empty when the tenant has turned email-link review off. | `https://app.example.com/quote/Qm9n0xv3kP2s5Yh8TqLw1AaBcDeFgHiJkLmNoPqRsTu` |
| `{{customMessage}}` | string | Optional free-text note from the MSP shown in a highlighted box; the box is hidden when empty. | `Let us know if you would like us to adjust the scope.` |

### quote-reminder-email

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{quote.number}}` | string | The quote's human-readable number as shown to the client. | `Q-0042` |
| `{{quote.amount}}` | string | Total value of the quote, pre-formatted as a currency string. | `$10,000.00` |
| `{{quote.validUntil}}` | date | The date the quote expires, formatted for display. | `March 31, 2026` |
| `{{company.name}}` | string | The MSP's own company name, shown as the sender in the subject, intro, and signature. | `Contoso IT Services` |
| `{{portalLink}}` | url | Link to the client-portal quotes tab where the quote can be reviewed; the block is hidden when empty. | `https://app.example.com/client-portal/billing?tab=quotes` |
| `{{quoteReviewLink}}` | url | Per-recipient link to review and approve the quote without signing in; empty when the tenant has turned email-link review off. | `https://app.example.com/quote/Qm9n0xv3kP2s5Yh8TqLw1AaBcDeFgHiJkLmNoPqRsTu` |
| `{{customMessage}}` | string | Optional free-text note from the MSP shown in a highlighted box; the box is hidden when empty. | `Let us know if you would like us to adjust the scope.` |

## SLA

### sla-breach

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{recipientName}}` | string | Name of the MSP staff member (assignee, board manager, or escalation manager) receiving this alert | `John Doe` |
| `{{ticketNumber}}` | string | Human-readable ticket number of the breached ticket | `TCK-1234` |
| `{{slaType}}` | string | Which SLA clock was breached — Response or Resolution | `Response` |
| `{{ticketTitle}}` | string | Title/summary of the breached ticket | `Network connectivity issue in Building A` |
| `{{timeOverdue}}` | string | How long the ticket has been past its SLA target, human-formatted | `15 minutes` |
| `{{priority}}` | string | Priority level of the ticket | `High` |
| `{{clientName}}` | string | Name of the client company the ticket belongs to | `Acme Corporation` |
| `{{policyName}}` | string | Name of the SLA policy that was breached | `Critical Response SLA` |
| `{{ticketUrl}}` | string | Relative link to open the ticket in the MSP app; the View Ticket button/link only renders when present | `/msp/tickets/sample-ticket-id` |
| `{{priorityName}}` | string | Priority level of the ticket (duplicate of priority) | `High` |
| `{{thresholdPercent}}` | number | SLA elapsed-time threshold percentage that triggered the notification (>=100 means breach) | `100` |
| `{{remainingTime}}` | string | Formatted remaining/overdue time (duplicate of timeOverdue) | `0 minutes` |
| `{{timeRemaining}}` | string | Formatted remaining time (duplicate of timeOverdue for breach) | `0 minutes` |
| `{{dueAt}}` | date | ISO timestamp of the SLA due date/time | `2026-07-17T12:00:00.000Z` |

### sla-warning

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{recipientName}}` | string | Name of the MSP staff member responsible for the ticket receiving the warning | `John Doe` |
| `{{ticketNumber}}` | string | Human-readable ticket number approaching its SLA deadline | `TCK-1234` |
| `{{thresholdPercent}}` | number | Percentage of SLA time elapsed that triggered the warning | `75` |
| `{{ticketTitle}}` | string | Title/summary of the ticket approaching breach | `Network connectivity issue in Building A` |
| `{{slaType}}` | string | Which SLA clock is at risk — Response or Resolution | `Resolution` |
| `{{timeRemaining}}` | string | Time left before the SLA is breached, human-formatted | `30 minutes` |
| `{{priority}}` | string | Priority level of the ticket | `High` |
| `{{clientName}}` | string | Name of the client company the ticket belongs to | `Acme Corporation` |
| `{{ticketUrl}}` | string | Relative link to open the ticket; View Ticket button/link renders only when present | `/msp/tickets/sample-ticket-id` |
| `{{priorityName}}` | string | Priority level (duplicate of priority) | `High` |
| `{{policyName}}` | string | Name of the SLA policy in effect | `Standard Resolution SLA` |
| `{{remainingTime}}` | string | Formatted remaining time (duplicate of timeRemaining) | `30 minutes` |
| `{{timeOverdue}}` | string | Formatted overdue/remaining time (duplicate of timeRemaining) | `0 minutes` |
| `{{dueAt}}` | date | ISO timestamp of the SLA due date/time | `2026-07-17T12:00:00.000Z` |

### sla-escalation

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{recipientName}}` | string | Name of the escalation manager the ticket was escalated to | `John Doe` |
| `{{ticketNumber}}` | string | Human-readable ticket number that was escalated | `TCK-1234` |
| `{{escalationLevel}}` | number | Escalation tier the ticket was raised to (1, 2, or 3) | `2` |
| `{{ticketTitle}}` | string | Title/summary of the escalated ticket | `Critical server outage` |
| `{{escalationReason}}` | string | Why the ticket was escalated | `SLA threshold reached - escalated to level 2` |
| `{{priority}}` | string | Priority level of the escalated ticket | `High` |
| `{{clientName}}` | string | Name of the client company the ticket belongs to | `Acme Corporation` |
| `{{assigneeName}}` | string | Name of the technician currently assigned to the ticket | `Jane Smith` |
| `{{ticketUrl}}` | string | Relative link to open the escalated ticket; View Ticket button/link renders only when present | `/msp/tickets/sample-ticket-id` |

## Surveys

### SURVEY_TICKET_CLOSED

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket_number}}` | string | The human-readable ticket number (or ticket ID fallback) for the closed ticket the survey is about. | `TCK-1234` |
| `{{contact_name}}` | string | Full name of the client contact receiving the survey invitation. | `Jane Smith` |
| `{{ticket_subject}}` | string | The title/subject of the closed ticket. | `Printer not working on 3rd floor` |
| `{{technician_name}}` | string | Name of the technician who worked the ticket, shown so the customer knows who they are rating. | `John Doe` |
| `{{prompt_text}}` | string | The configurable survey question prompting the customer to rate their experience. | `How would you rate your support experience?` |
| `{{thank_you_text}}` | string | Configurable closing thank-you message shown after the rating options. | `Thank you for helping us improve!` |
| `{{{rating_buttons_html}}}` | raw-html | Pre-rendered HTML block of inline rating buttons (stars, numbers, or emojis) the customer clicks to submit a score directly from the email. | `<a href="https://app.example.com/surveys/respond/sample-token?rating=1">1 ★</a> ...` |
| `{{survey_url}}` | url | Secure fallback link to the full web survey page, used if the inline buttons don't load. | `https://app.example.com/surveys/respond/sample-token` |
| `{{rating_links_text}}` | string | Plain-text list of rating options as 'display: url' pairs, used in the text-only version of the email and as an HTML fallback line. | `1 ★: https://app.example.com/surveys/respond/sample-token?rating=1 2 ★★: https://app.example.com/surveys/respond/sample-token?rating=2` |
| `{{tenant_name}}` | string | Display name of the MSP/tenant sending the survey, shown in the email footer. | `Acme IT Support` |
| `{{ticket_closed_at}}` | date | Timestamp when the ticket was closed, shown in the email footer. | `2026-05-12T19:09:00.000Z` |
| `{{rating_scale}}` | number | The maximum rating value on the survey scale (e.g. 5 for a 1-5 scale). | `5` |
| `{{rating_type}}` | string | The style of rating widget: 'stars', 'emojis', or numeric. | `stars` |
| `{{rating_labels}}` | object | Optional per-score text labels keyed by rating number (e.g. {"1":"Poor", ... "5":"Excellent"}). | `{"1":"Poor","2":"Fair","3":"Good","4":"Great","5":"Excellent"}` |
| `{{comment_prompt}}` | string | Optional prompt inviting the customer to leave free-text feedback. | `Share additional feedback (optional).` |
| `{{company_name}}` | string | Name of the client company associated with the ticket. | `Acme Corporation` |
| `{{expires_at}}` | date | Timestamp when the survey invitation link expires (send time + 7 days by default). | `2026-05-19T19:09:00.000Z` |

## Tickets

### ticket-agent-assigned-client

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line; shown in the subject, header, and used throughout. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line summary combining ticket number, priority, and status, shown under the header and in the text body. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number shown on the 'Ticket #' badge (mapped from ticket_number). | `TCK-1234` |
| `{{ticket.clientName}}` | string | Name of the client/company the ticket belongs to, shown in the intro sentence. | `Acme Corporation` |
| `{{ticket.assignedToName}}` | string | Full name of the agent now assigned to the ticket; central to this notification. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email address of the assigned agent (or 'Not assigned'/'Not provided'), shown under the agent name. | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email in parentheses, used in the plain-text body. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge background (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined for display. | `Hardware / Printer` |
| `{{ticket.requesterName}}` | string | Name of the contact who requested the ticket. | `John Doe` |
| `{{ticket.url}}` | string | Client-portal deep link to the ticket (the 'View Ticket' button). | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{ticket.category}}` | string | Top-level category name; present in the reduced context but the template renders categoryDetails instead. | `Hardware` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

### ticket-assigned

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.priority}}` | string | Priority level name; appears in the subject and the priority badge. | `High` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary shown under the header and in text. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.assignedBy}}` | string | Full name of the user who performed the assignment (or 'System'). | `John Doe` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email in parentheses, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name, email, and phone joined for the plain-text body. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address of the ticket location. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.description}}}` | raw-html | Ticket description body (HTML-rendered via {{{ }}} in en/pt; plain {{ }} in fr/es/de/nl/it); falls back to 'No description provided.'. | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | MSP deep link to the ticket (the 'View Ticket' button). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but not referenced in this template. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but not referenced. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category name; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory name; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-auto-close-warning

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | Short meta line under the header; for this event it is just the ticket number. | `Ticket #TCK-1234` |
| `{{ticket.id}}` | string | Human-readable ticket number shown on the 'Ticket #' badge (mapped from ticketNumber). | `TCK-1234` |
| `{{ticket.scheduledCloseDate}}` | string | Formatted date the ticket will auto-close if the customer does not reply (toLocaleDateString('en-US', long month). | `March 31, 2026` |
| `{{ticket.url}}` | string | Client-portal deep link to the ticket (the 'View Ticket' button). | `https://portal.example.com/client-portal/tickets/sample-ticket-id?tenant=acme` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

### ticket-closed

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary shown under the header and in text. | `Ticket #TCK-1234 · High Priority · Closed` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.closedBy}}` | string | Full name of the user who closed the ticket (or 'System'). | `John Doe` |
| `{{ticket.status}}` | string | Current status name; used in the pl plain-text 'Closed status' line (other locales show a static 'Closed' label). | `Closed` |
| `{{ticket.priority}}` | string | Priority level name; rendered only in the pl priority row. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge; rendered only in the pl priority row. | `#dc2626` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.resolution}}}` | raw-html | HTML of the resolution comment shown in the 'Resolution' box (rendered via {{{ }}}). | `<p>Replaced printer toner cartridge.</p>` |
| `{{ticket.url}}` | string | Deep link to the ticket (portal for the client, MSP for the assignee/resources). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled into the closed context but not referenced by this template. | `Toner is jammed and red error light is on.` |
| `{{{ticket.changes}}}` | raw-html | Rendered HTML change list; assembled (from payload.changes) but not referenced by ticket-closed. | `<ul>…</ul>` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{ticket.assets}}` | array | Linked assets. Iterate to choose columns; values are plain data, not HTML. | `[{ assetTag: 'AST-0042', name: 'Office Printer', assetType: 'Printer', manufacturer: 'Brother', model: 'HL-L6200DW', serialNumber: 'SN-0042', status: 'active', location: 'Front office', relationship: 'affected' }]` |
| `{{ticket.assets[].assetTag}}` | string | Linked asset assetTag. | `AST-0042` |
| `{{ticket.assets[].name}}` | string | Linked asset name. | `Office Printer` |
| `{{ticket.assets[].assetType}}` | string | Linked asset assetType. | `Printer` |
| `{{ticket.assets[].manufacturer}}` | string | Linked asset manufacturer. | `Brother` |
| `{{ticket.assets[].model}}` | string | Linked asset model. | `HL-L6200DW` |
| `{{ticket.assets[].serialNumber}}` | string | Linked asset serialNumber. | `SN-0042` |
| `{{ticket.assets[].status}}` | string | Linked asset status. | `active` |
| `{{ticket.assets[].location}}` | string | Linked asset location. | `Front office` |
| `{{ticket.assets[].relationship}}` | string | Linked asset relationship. | `affected` |
| `{{ticket.materials}}` | array | Material rows with quantity, currency-formatted rate and amount, and billed state. | `[{ name: 'Toner cartridge', description: 'Replacement toner', quantity: 2, rate: '45.00', amount: '90.00', currencyCode: 'XXX', billed: true }]` |
| `{{ticket.materials[].name}}` | string | Material name. | `Toner cartridge` |
| `{{ticket.materials[].description}}` | string | Material description. | `Replacement toner` |
| `{{ticket.materials[].quantity}}` | number | Material quantity. | `2` |
| `{{ticket.materials[].rate}}` | string | Material rate. | `45.00` |
| `{{ticket.materials[].amount}}` | string | Material amount. | `90.00` |
| `{{ticket.materials[].currencyCode}}` | string | Material currencyCode. | `XXX` |
| `{{ticket.materials[].billed}}` | boolean | Material billed. | `true` |
| `{{ticket.materialsTotal}}` | string | Material totals, kept separate by currency when necessary. | `90.00` |
| `{{ticket.timeEntries}}` | array | Individual time entries, oldest first. Date, technician, worked and billable can be laid out as an editable table. | `[{ date: '06/10/2025', technician: 'Jane Smith', worked: '1 hr, 30 min', billable: '1 hr' }]` |
| `{{ticket.timeEntries[].date}}` | string | Time entry date. | `06/10/2025` |
| `{{ticket.timeEntries[].technician}}` | string | Time entry technician. | `Jane Smith` |
| `{{ticket.timeEntries[].worked}}` | string | Time entry worked. | `1 hr, 30 min` |
| `{{ticket.timeEntries[].billable}}` | string | Time entry billable. | `1 hr` |
| `{{ticket.totalTimeWorked}}` | string | Total recorded worked duration, including non-billable time. | `3 hr, 30 min` |
| `{{ticket.totalTimeBillable}}` | string | Total recorded billable duration, whether invoiced or not. | `2 hr, 15 min` |
| `{{ticket.remainingBlockHours}}` | string | Live available prepaid hour-block balance for the client at send time. | `12 hr, 45 min` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-comment-added

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact (also used in the pl layout). | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{ticket.url}}` | string | Deep link to the ticket (portal for external, MSP internal for agents/watchers). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{comment.author}}` | string | Display of who wrote the comment (from payload.comment.author; often an email). | `jane.smith@example.com` |
| `{{{comment.content}}}` | raw-html | Rendered HTML of the comment body with inline images rewritten to CID references (rendered via {{{ }}}). | `<p>Toner cartridge has been ordered, ETA tomorrow.</p>` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled into the comment context but not referenced by this template. | `Toner is jammed and red error light is on.` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{comment.html}}` | string | Same as comment.content (rewritten HTML); duplicate field on the comment context, unused. | `<p>Toner cartridge has been ordered.</p>` |
| `{{comment.text}}` | string | Plain-text extraction of the comment body; assembled but not referenced. | `Toner cartridge has been ordered, ETA tomorrow.` |
| `{{comment.plainText}}` | string | Duplicate plain-text of the comment body; assembled but unused. | `Toner cartridge has been ordered, ETA tomorrow.` |
| `{{comment.rawContent}}` | string | Original unprocessed comment content (BlockNote/raw) from the payload; assembled but unused. | `[{"type":"paragraph"}]` |
| `{{comment.id}}` | string | Comment identifier from the payload; assembled onto the context via spread but unused in the template. | `cmt-98765` |
| `{{comment.isInternal}}` | boolean | Whether the comment is internal-only; from the payload, used in JS gating (not the template). | `false` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-created

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line; appears in the subject and header. | `Printer not working on 3rd floor` |
| `{{ticket.priority}}` | string | Priority level name; appears in the subject and the priority badge. | `High` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · New` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro and text header. | `Acme Corporation` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `New` |
| `{{ticket.createdAt}}` | string | Formatted creation date/time of the ticket (Intl date-time with short timezone). | `May 12, 2026, 3:04 PM EDT` |
| `{{ticket.createdBy}}` | string | Full name of who created the ticket (or 'System'). | `John Doe` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.description}}}` | raw-html | Ticket description body (HTML-rendered via {{{ }}}); falls back to 'No description provided.'. | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | MSP deep link to the ticket (the 'View Ticket' button). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{ticket.createdDetails}}` | string | Combined '<createdAt> · <createdBy>' string; assembled but the template composes the parts itself. | `May 12, 2026, 3:04 PM EDT · John Doe` |
| `{{ticket.descriptionText}}` | string | Plain-text version of the description; assembled but not referenced. | `Toner is jammed and red error light is on.` |
| `{{ticket.descriptionHtml}}` | string | HTML version of the description; assembled separately but the template uses ticket.description. | `<p>Toner is jammed…</p>` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-board-created

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line; appears in the subject and header. | `Printer not working on 3rd floor` |
| `{{ticket.priority}}` | string | Priority level name; appears in the subject and the priority badge. | `High` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · New` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro and text header. | `Acme Corporation` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `New` |
| `{{ticket.createdAt}}` | string | Formatted creation date/time of the ticket (Intl date-time with short timezone). | `May 12, 2026, 3:04 PM EDT` |
| `{{ticket.createdBy}}` | string | Full name of who created the ticket (or 'System'). | `John Doe` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.description}}}` | raw-html | Ticket description body (HTML-rendered via {{{ }}}); falls back to 'No description provided.'. | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | MSP deep link to the ticket (the 'View Ticket' button). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{ticket.createdDetails}}` | string | Combined '<createdAt> · <createdBy>' string; assembled but the template composes the parts itself. | `May 12, 2026, 3:04 PM EDT · John Doe` |
| `{{ticket.descriptionText}}` | string | Plain-text version of the description; assembled but not referenced. | `Toner is jammed and red error light is on.` |
| `{{ticket.descriptionHtml}}` | string | HTML version of the description; assembled separately but the template uses ticket.description. | `<p>Toner is jammed…</p>` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-board-status-entered

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line; appears in the subject and header. | `Printer not working on 3rd floor` |
| `{{ticket.priority}}` | string | Priority level name; appears in the subject and the priority badge. | `High` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · New` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro and text header. | `Acme Corporation` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `New` |
| `{{ticket.previousStatus}}` | string | Name of the status the ticket left. | `In Progress` |
| `{{ticket.enteredStatus}}` | string | Name of the status the ticket just entered. | `Resolved` |
| `{{ticket.createdAt}}` | string | Formatted creation date/time of the ticket (Intl date-time with short timezone). | `May 12, 2026, 3:04 PM EDT` |
| `{{ticket.createdBy}}` | string | Full name of who created the ticket (or 'System'). | `John Doe` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.description}}}` | raw-html | Ticket description body (HTML-rendered via {{{ }}}); falls back to 'No description provided.'. | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | MSP deep link to the ticket (the 'View Ticket' button). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{ticket.createdDetails}}` | string | Combined '<createdAt> · <createdBy>' string; assembled but the template composes the parts itself. | `May 12, 2026, 3:04 PM EDT · John Doe` |
| `{{ticket.descriptionText}}` | string | Plain-text version of the description; assembled but not referenced. | `Toner is jammed and red error light is on.` |
| `{{ticket.descriptionHtml}}` | string | HTML version of the description; assembled separately but the template uses ticket.description. | `<p>Toner is jammed…</p>` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-created-client

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary shown under the header and in text. | `Ticket #TCK-1234 · High Priority · New` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `New` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent (name only; email intentionally omitted for clients). | `Jane Smith` |
| `{{{ticket.description}}}` | raw-html | Ticket description body shown in the description box (rendered via {{ }}). | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | Client-portal deep link to the ticket (the 'View Ticket' button). | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{ticket.createdAt}}` | string | Formatted creation date/time; assembled but not shown to clients. | `May 12, 2026, 3:04 PM EDT` |
| `{{ticket.createdBy}}` | string | Creator name; assembled but not shown to clients. | `John Doe` |
| `{{ticket.createdDetails}}` | string | Combined createdAt · createdBy; assembled but unused. | `May 12, 2026, 3:04 PM EDT · John Doe` |
| `{{ticket.assignedToEmail}}` | string | Assigned agent email; assembled but intentionally hidden from clients. | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name+email; assembled but unused. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Requesting contact name; assembled but not referenced. | `John Doe` |
| `{{ticket.requesterEmail}}` | string | Requester email; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.requesterContact}}` | string | Requester email+phone; assembled but unused. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone; assembled but unused. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue; assembled but hidden from clients. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category/subcategory; assembled but hidden from clients. | `Hardware / Printer` |
| `{{ticket.category}}` | string | Top-level category; assembled but unused. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; assembled but unused. | `Printer` |
| `{{ticket.locationSummary}}` | string | Client site/address; assembled but hidden from clients. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{ticket.descriptionText}}` | string | Plain-text description; assembled but unused. | `Toner is jammed and red error light is on.` |
| `{{ticket.descriptionHtml}}` | string | HTML description; assembled but the template uses ticket.description. | `<p>Toner is jammed…</p>` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

### ticket-team-assigned

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.teamName}}` | string | Name of the team assigned to the ticket; central to this notification. | `Network Team` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.assignedBy}}` | string | Full name of the user who assigned the team (or 'System'). | `John Doe` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.description}}}` | raw-html | Ticket description body (HTML-rendered via {{{ }}}). | `Toner is jammed and red error light is on.` |
| `{{ticket.url}}` | string | Client-portal deep link to the ticket (the 'View Ticket' button). | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{ticket.assignedToName}}` | string | Assigned individual agent name; present in context but not shown in the team-assigned template. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Assigned agent email; present but unused. | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name+email; present but unused. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-updated

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line; appears in subject and header. | `Printer not working on 3rd floor` |
| `{{ticket.priority}}` | string | Priority level name; appears in the subject and the priority badge. | `High` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.updatedBy}}` | string | Name of who made the update (comma-joined list of updaters on the accumulated path; 'System' if unknown). | `John Doe` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.changes}}}` | raw-html | Rendered HTML list of field changes (old→new, grouped by updater/timestamp) shown in the 'Changes Made' box (rendered via {{{ }}}). | `<ul><li>Priority: Medium → High</li></ul>` |
| `{{ticket.changeItems}}` | array | The field changes in this email, one item per field, laid out by the template's 'Changes Made' box. The template owns all colors, so email branding restyles it. | `[{ label: 'Priority', oldValue: 'Medium', newValue: 'High', updatedBy: '', updatedAt: '' }]` |
| `{{ticket.changeItems.label}}` | string | Display name of the changed field. | `Priority` |
| `{{ticket.changeItems.oldValue}}` | string | The field's previous value, resolved to a display name. Empty when the change has no previous value; wrap it in {{#if this.oldValue}}. | `Medium` |
| `{{ticket.changeItems.newValue}}` | string | The field's new value, resolved to a display name. | `High` |
| `{{ticket.changeItems.updatedBy}}` | string | Bundled updates only: who made this update, set on the first item of each update and empty on the rest. Wrap a heading in {{#if this.updatedBy}}. | `Dana Whitfield` |
| `{{ticket.changeItems.updatedAt}}` | string | Bundled updates only: when that update was made, in the tenant's time zone and locale; set on the same item as updatedBy. | `Nov 17, 2026, 03:04 PM EST` |
| `{{ticket.url}}` | string | MSP deep link to the ticket (the 'View Ticket' button). | `https://app.example.com/msp/tickets/sample-ticket-id` |
| `{{ticket.updateCount}}` | number | Number of accumulated updates in this batch (accumulated path only); assembled but not referenced by the template. | `2` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled into the updated context but not referenced. | `Toner is jammed and red error light is on.` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `true` |

### ticket-updated-client

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary shown under the header and in text. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent (name only; email hidden from clients). | `Jane Smith` |
| `{{{ticket.changes}}}` | raw-html | Rendered HTML list of field changes shown in the 'What Changed' box (rendered via {{{ }}}). | `<ul><li>Status: New → In Progress</li></ul>` |
| `{{ticket.changeItems}}` | array | The field changes in this email, one item per field, laid out by the template's 'Changes Made' box. The template owns all colors, so email branding restyles it. | `[{ label: 'Status', oldValue: 'New', newValue: 'In Progress', updatedBy: '', updatedAt: '' }]` |
| `{{ticket.changeItems.label}}` | string | Display name of the changed field. | `Status` |
| `{{ticket.changeItems.oldValue}}` | string | The field's previous value, resolved to a display name. Empty when the change has no previous value; wrap it in {{#if this.oldValue}}. | `New` |
| `{{ticket.changeItems.newValue}}` | string | The field's new value, resolved to a display name. | `In Progress` |
| `{{ticket.changeItems.updatedBy}}` | string | Bundled updates only: who made this update, set on the first item of each update and empty on the rest. Wrap a heading in {{#if this.updatedBy}}. | `Dana Whitfield` |
| `{{ticket.changeItems.updatedAt}}` | string | Bundled updates only: when that update was made, in the tenant's time zone and locale; set on the same item as updatedBy. | `Nov 17, 2026, 03:04 PM EST` |
| `{{ticket.url}}` | string | Client-portal deep link to the ticket (the 'View Ticket' button). | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{ticket.updatedBy}}` | string | Name of who updated; assembled but not shown to clients. | `John Doe` |
| `{{ticket.updateCount}}` | number | Number of accumulated updates (accumulated path only); assembled but unused. | `2` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled but not referenced. | `Toner is jammed and red error light is on.` |
| `{{ticket.assignedToEmail}}` | string | Assigned agent email; assembled but hidden from clients. | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name+email; assembled but unused. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Requesting contact name; assembled but unused. | `John Doe` |
| `{{ticket.requesterEmail}}` | string | Requester email; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.requesterContact}}` | string | Requester email+phone; assembled but unused. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone; assembled but unused. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue; assembled but hidden from clients. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category/subcategory; assembled but hidden from clients. | `Hardware / Printer` |
| `{{ticket.category}}` | string | Top-level category; assembled but unused. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; assembled but unused. | `Printer` |
| `{{ticket.locationSummary}}` | string | Client site/address; assembled but hidden from clients. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

### ticket-comment-added-client

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary. | `Ticket #TCK-1234 · High Priority · In Progress` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.priority}}` | string | Priority level name, shown in the priority badge. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge (defaults to #8A4DEA). | `#dc2626` |
| `{{ticket.status}}` | string | Current workflow status name. | `In Progress` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact (also used in the pl layout). | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{ticket.url}}` | string | Client-portal link to the ticket. | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{comment.author}}` | string | Display of who wrote the comment (from payload.comment.author; often an email). | `jane.smith@example.com` |
| `{{{comment.content}}}` | raw-html | Rendered HTML of the comment body with inline images rewritten to CID references (rendered via {{{ }}}). | `<p>Toner cartridge has been ordered, ETA tomorrow.</p>` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled into the comment context but not referenced by this template. | `Toner is jammed and red error light is on.` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{comment.html}}` | string | Same as comment.content (rewritten HTML); duplicate field on the comment context, unused. | `<p>Toner cartridge has been ordered.</p>` |
| `{{comment.text}}` | string | Plain-text extraction of the comment body; assembled but not referenced. | `Toner cartridge has been ordered, ETA tomorrow.` |
| `{{comment.plainText}}` | string | Duplicate plain-text of the comment body; assembled but unused. | `Toner cartridge has been ordered, ETA tomorrow.` |
| `{{comment.rawContent}}` | string | Original unprocessed comment content (BlockNote/raw) from the payload; assembled but unused. | `[{"type":"paragraph"}]` |
| `{{comment.id}}` | string | Comment identifier from the payload; assembled onto the context via spread but unused in the template. | `cmt-98765` |
| `{{comment.isInternal}}` | boolean | Whether the comment is internal-only; from the payload, used in JS gating (not the template). | `false` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

### ticket-closed-client

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{ticket.title}}` | string | The ticket's subject/title line. | `Printer not working on 3rd floor` |
| `{{ticket.metaLine}}` | string | One-line ticket#/priority/status summary shown under the header and in text. | `Ticket #TCK-1234 · High Priority · Closed` |
| `{{ticket.id}}` | string | Human-readable ticket number on the 'Ticket #' badge. | `TCK-1234` |
| `{{ticket.clientName}}` | string | Client/company the ticket belongs to; shown in the intro. | `Acme Corporation` |
| `{{ticket.closedBy}}` | string | Full name of the user who closed the ticket (or 'System'). | `John Doe` |
| `{{ticket.status}}` | string | Current status name; used in the pl plain-text 'Closed status' line (other locales show a static 'Closed' label). | `Closed` |
| `{{ticket.priority}}` | string | Priority level name; rendered only in the pl priority row. | `High` |
| `{{ticket.priorityColor}}` | string | Hex color for the priority badge; rendered only in the pl priority row. | `#dc2626` |
| `{{ticket.assignedToName}}` | string | Full name of the assigned agent. | `Jane Smith` |
| `{{ticket.assignedToEmail}}` | string | Email of the assigned agent (or 'Not assigned'/'Not provided'). | `jane.smith@example.com` |
| `{{ticket.assignedDetails}}` | string | Assigned agent name with email, for plain text. | `Jane Smith (jane.smith@example.com)` |
| `{{ticket.requesterName}}` | string | Name of the requesting contact. | `John Doe` |
| `{{ticket.requesterContact}}` | string | Requester email and phone joined for the HTML contact block. | `john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.requesterDetails}}` | string | Requester name/email/phone joined for plain text. | `John Doe · john.doe@acme.com · +1 (555) 010-1234` |
| `{{ticket.board}}` | string | Board/queue the ticket lives on. | `Help Desk` |
| `{{ticket.categoryDetails}}` | string | Category / subcategory combined. | `Hardware / Printer` |
| `{{ticket.locationSummary}}` | string | Client site name and address. | `Acme HQ • 100 Main St, Springfield, IL 62701 US` |
| `{{{ticket.resolution}}}` | raw-html | The latest client-visible resolution as HTML (rendered via {{{ }}}); empty when there is none, which hides the Resolution box. | `<p>Replaced printer toner cartridge.</p>` |
| `{{ticket.url}}` | string | Client-portal link to the ticket. | `https://portal.example.com/client-portal/tickets/sample-ticket-id` |
| `{{{ticket.description}}}` | raw-html | Ticket description body; assembled into the closed context but not referenced by this template. | `Toner is jammed and red error light is on.` |
| `{{{ticket.changes}}}` | raw-html | Rendered HTML change list; assembled (from payload.changes) but not referenced by ticket-closed. | `<ul>…</ul>` |
| `{{ticket.requesterEmail}}` | string | Requester email in isolation; assembled but unused. | `john.doe@acme.com` |
| `{{ticket.requesterPhone}}` | string | Requester phone in isolation; assembled but unused. | `+1 (555) 010-1234` |
| `{{ticket.category}}` | string | Top-level category; template uses categoryDetails instead. | `Hardware` |
| `{{ticket.subcategory}}` | string | Subcategory; template uses categoryDetails instead. | `Printer` |
| `{{ticket.assets}}` | array | Linked assets. Iterate to choose columns; values are plain data, not HTML. | `[{ assetTag: 'AST-0042', name: 'Office Printer', assetType: 'Printer', manufacturer: 'Brother', model: 'HL-L6200DW', serialNumber: 'SN-0042', status: 'active', location: 'Front office', relationship: 'affected' }]` |
| `{{ticket.assets[].assetTag}}` | string | Linked asset assetTag. | `AST-0042` |
| `{{ticket.assets[].name}}` | string | Linked asset name. | `Office Printer` |
| `{{ticket.assets[].assetType}}` | string | Linked asset assetType. | `Printer` |
| `{{ticket.assets[].manufacturer}}` | string | Linked asset manufacturer. | `Brother` |
| `{{ticket.assets[].model}}` | string | Linked asset model. | `HL-L6200DW` |
| `{{ticket.assets[].serialNumber}}` | string | Linked asset serialNumber. | `SN-0042` |
| `{{ticket.assets[].status}}` | string | Linked asset status. | `active` |
| `{{ticket.assets[].location}}` | string | Linked asset location. | `Front office` |
| `{{ticket.assets[].relationship}}` | string | Linked asset relationship. | `affected` |
| `{{ticket.timeEntries}}` | array | Individual time entries, oldest first. Date, technician, worked and billable can be laid out as an editable table. | `[{ date: '06/10/2025', technician: 'Jane Smith', worked: '1 hr, 30 min', billable: '1 hr' }]` |
| `{{ticket.timeEntries[].date}}` | string | Time entry date. | `06/10/2025` |
| `{{ticket.timeEntries[].technician}}` | string | Time entry technician. | `Jane Smith` |
| `{{ticket.timeEntries[].worked}}` | string | Time entry worked. | `1 hr, 30 min` |
| `{{ticket.timeEntries[].billable}}` | string | Time entry billable. | `1 hr` |
| `{{ticket.totalTimeWorked}}` | string | Total recorded worked duration, including non-billable time. | `3 hr, 30 min` |
| `{{ticket.totalTimeBillable}}` | string | Total recorded billable duration, whether invoiced or not. | `2 hr, 15 min` |
| `{{ticket.remainingBlockHours}}` | string | Live available prepaid hour-block balance for the client at send time. | `12 hr, 45 min` |
| `{{recipient.isInternal}}` | boolean | True when this copy goes to MSP staff, false when it goes to the client side. Branch on it with {{#if recipient.isInternal}}…{{else}}…{{/if}}. | `false` |

## Time

### time-entry-approved

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{timeEntry.date}}` | string | The date the work was logged for on the approved time entry | `May 12, 2026` |
| `{{timeEntry.duration}}` | string | How much time was recorded on the entry, as a human-readable duration | `2h 30m` |
| `{{timeEntry.project}}` | string | Name of the project (or work item) the time was booked against | `Q2 Rollout` |
| `{{timeEntry.task}}` | string | Name of the specific task the time was logged under | `Firewall migration` |
| `{{timeEntry.approvedBy}}` | string | Name of the manager/approver who approved the time entry | `Jane Smith` |
| `{{timeEntry.url}}` | url | Deep link to view the approved time entry in the app | `https://app.example.com/msp/time-management/entries/sample-entry-id` |

### time-entry-rejected

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{timeEntry.date}}` | string | The date the work was logged for on the rejected time entry | `May 12, 2026` |
| `{{timeEntry.duration}}` | string | How much time was recorded on the entry, as a human-readable duration | `2h 30m` |
| `{{timeEntry.project}}` | string | Name of the project (or work item) the time was booked against | `Q2 Rollout` |
| `{{timeEntry.task}}` | string | Name of the specific task the time was logged under | `Firewall migration` |
| `{{timeEntry.rejectedBy}}` | string | Name of the manager/approver who rejected the time entry | `Jane Smith` |
| `{{timeEntry.rejectionReason}}` | string | The reason the approver gave for rejecting the time entry (rendered under the 'Reason' label) | `Duration exceeds the task quote — please split into two entries` |
| `{{timeEntry.url}}` | url | Deep link to view/edit the rejected time entry in the app | `https://app.example.com/msp/time-management/entries/sample-entry-id` |

### time-entry-submitted

> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.

| Variable | Type | Description | Example |
| --- | --- | --- | --- |
| `{{timeEntry.submittedBy}}` | string | Name of the technician/user who submitted the time entry for review | `John Doe` |
| `{{timeEntry.date}}` | string | The date the work was logged for on the submitted time entry | `May 12, 2026` |
| `{{timeEntry.duration}}` | string | How much time was recorded on the entry, as a human-readable duration | `2h 30m` |
| `{{timeEntry.project}}` | string | Name of the project (or work item) the time was booked against | `Q2 Rollout` |
| `{{timeEntry.task}}` | string | Name of the specific task the time was logged under | `Firewall migration` |
| `{{timeEntry.url}}` | url | Deep link for the approver to review the submitted time entry in the app | `https://app.example.com/msp/time-management/entries/sample-entry-id` |

## Notes

- A value called `ticket.id` or `project.id` is the human-readable ticket or project number, not a database UUID.
- Some URL variables open the client portal for external recipients and the MSP workspace for internal recipients. Do not assume the hostname from the example value.
- Dates may be pre-formatted display text or ISO timestamps. Follow the description for the specific variable rather than applying one date format to every template.
- Keep conditional sections such as `{{#if contactPhone}}...{{/if}}` when the value is optional.

