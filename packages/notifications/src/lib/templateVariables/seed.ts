/**
 * Generated from docs/plans/2026-07-17-email-template-variables-inventory.json.
 * Run packages/notifications/scripts/generate-variable-registry-seed.mjs after
 * an approved inventory change; runtime code must not import planning files.
 */
type SeedVariable = {
  path: string;
  type: string;
  description: string;
  example: string;
  availability: string;
  notes?: string;
};

type TemplateVariableSeedCategory = {
  category: string;
  templates: Array<{
    templateName: string;
    variables: SeedVariable[];
  }>;
};

type SharedVariableBlockSeed = {
  name: string;
  usedByCategories: string[];
  notes: string;
  variables: SeedVariable[];
};

export const templateVariableSeed: TemplateVariableSeedCategory[] = [
  {
    "category": "appointments",
    "templates": [
      {
        "templateName": "appointment-request-received",
        "variables": [
          {
            "path": "serviceName",
            "type": "string",
            "description": "Name of the requested service.",
            "example": "Network Assessment",
            "availability": "used"
          },
          {
            "path": "requesterName",
            "type": "string",
            "description": "Name of the person who submitted the request; greeting is generic if absent.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if requesterName}} in the greeting."
          },
          {
            "path": "referenceNumber",
            "type": "string",
            "description": "Short reference code for the request the customer can quote when following up.",
            "example": "APT-LZ3K9-QX7A",
            "availability": "used",
            "notes": "Format differs by call site: public route (route.ts line 283) uses generateReferenceNumber() = 'APT-<base36 timestamp>-<random>'; portal action (appointmentRequestActions.ts line 630) uses the first 8 chars of appointment_request_id, uppercased (e.g. 'A1B2C3D4')."
          },
          {
            "path": "requestedDate",
            "type": "string",
            "description": "The date the customer asked for, pre-formatted.",
            "example": "Monday, July 21, 2026",
            "availability": "used"
          },
          {
            "path": "requestedTime",
            "type": "string",
            "description": "The time the customer asked for, pre-formatted with a parenthesized timezone label.",
            "example": "2:00 PM (EDT)",
            "availability": "used"
          },
          {
            "path": "duration",
            "type": "number",
            "description": "Requested appointment length in minutes (label 'minutes' is appended by the template).",
            "example": "60",
            "availability": "used"
          },
          {
            "path": "preferredTechnician",
            "type": "string",
            "description": "Technician the customer requested by preference, if any.",
            "example": "John Doe",
            "availability": "used",
            "notes": "Optional. Row shown only inside {{#if preferredTechnician}}."
          },
          {
            "path": "responseTime",
            "type": "string",
            "description": "Typical turnaround the MSP promises before responding to the request.",
            "example": "24 hours",
            "availability": "used",
            "notes": "Hard-coded to '24 hours' at both call sites (route.ts 284, portal 631)."
          },
          {
            "path": "contactEmail",
            "type": "string",
            "description": "Support email address the customer can reach out to.",
            "example": "support@acme-it.com",
            "availability": "used"
          },
          {
            "path": "contactPhone",
            "type": "string",
            "description": "Support phone number, shown only when provided.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if contactPhone}}."
          },
          {
            "path": "requesterEmail",
            "type": "string",
            "description": "Email address of the requester (used as the send-to address).",
            "example": "jane.smith@client.com",
            "availability": "available-unused",
            "notes": "Assembled in the data object (used as recipient) but not referenced in the shipped template body."
          },
          {
            "path": "portalLink",
            "type": "string",
            "description": "URL to the client portal appointments area.",
            "example": "https://app.algapsa.com/client-portal/appointments",
            "availability": "available-unused",
            "notes": "Assembled at both call sites (route.ts 285, portal 632) but not referenced in the template."
          }
        ]
      },
      {
        "templateName": "appointment-request-approved",
        "variables": [
          {
            "path": "serviceName",
            "type": "string",
            "description": "Name of the confirmed service.",
            "example": "Network Assessment",
            "availability": "used"
          },
          {
            "path": "appointmentDate",
            "type": "string",
            "description": "Confirmed appointment date, pre-formatted.",
            "example": "Monday, July 21, 2026",
            "availability": "used"
          },
          {
            "path": "appointmentTime",
            "type": "string",
            "description": "Confirmed appointment time, pre-formatted.",
            "example": "2:00 PM EDT",
            "availability": "used"
          },
          {
            "path": "duration",
            "type": "number",
            "description": "Confirmed appointment length in minutes.",
            "example": "60",
            "availability": "used"
          },
          {
            "path": "requesterName",
            "type": "string",
            "description": "Name of the customer; greeting is generic if absent.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if requesterName}} in the greeting. Sourced from the contact full_name or request.requester_name (lines 1204-1216)."
          },
          {
            "path": "technicianName",
            "type": "string",
            "description": "Name of the technician assigned to the appointment (first_name + last_name).",
            "example": "John Doe",
            "availability": "used",
            "notes": "Optional. Entire technician block shown only inside {{#if technicianName}}."
          },
          {
            "path": "technicianEmail",
            "type": "string",
            "description": "Assigned technician's email address.",
            "example": "john.doe@acme-it.com",
            "availability": "used",
            "notes": "Optional. Shown only inside {{#if technicianEmail}}."
          },
          {
            "path": "technicianPhone",
            "type": "string",
            "description": "Assigned technician's phone number.",
            "example": "+1 (555) 010-5678",
            "availability": "used",
            "notes": "Optional. Shown only inside {{#if technicianPhone}}."
          },
          {
            "path": "onlineMeetingUrl",
            "type": "url",
            "description": "Microsoft Teams join link when the appointment is an online meeting.",
            "example": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123",
            "availability": "used",
            "notes": "Optional. 'Join Teams Meeting' button shown only inside {{#if onlineMeetingUrl}}."
          },
          {
            "path": "calendarLink",
            "type": "url",
            "description": "Link to download the appointment as an ICS calendar file.",
            "example": "https://app.algapsa.com/api/appointments/ics/abc123",
            "availability": "used",
            "notes": "Optional. 'Add to Calendar' button shown only inside {{#if calendarLink}}."
          },
          {
            "path": "cancellationPolicy",
            "type": "string",
            "description": "Cancellation policy text shown in a highlighted box.",
            "example": "Please cancel at least 24 hours in advance.",
            "availability": "used",
            "notes": "Optional. Box shown only inside {{#if cancellationPolicy}}. Hard-coded at the call site."
          },
          {
            "path": "minimumNoticeHours",
            "type": "number",
            "description": "Minimum advance notice (hours) required to reschedule or cancel.",
            "example": "24",
            "availability": "used",
            "notes": "Hard-coded to 24 at the call site."
          },
          {
            "path": "contactEmail",
            "type": "string",
            "description": "Support email for reschedule/cancel requests.",
            "example": "support@acme-it.com",
            "availability": "used"
          },
          {
            "path": "contactPhone",
            "type": "string",
            "description": "Support phone number, shown only when provided.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if contactPhone}}."
          },
          {
            "path": "requesterEmail",
            "type": "string",
            "description": "Customer's email address (used as the send-to address).",
            "example": "jane.smith@client.com",
            "availability": "available-unused",
            "notes": "Assembled (used as recipient) but not referenced in the template body."
          }
        ]
      },
      {
        "templateName": "appointment-request-declined",
        "variables": [
          {
            "path": "serviceName",
            "type": "string",
            "description": "Name of the service originally requested.",
            "example": "Network Assessment",
            "availability": "used"
          },
          {
            "path": "requesterName",
            "type": "string",
            "description": "Name of the customer; greeting is generic if absent.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if requesterName}} in the greeting."
          },
          {
            "path": "requestedDate",
            "type": "string",
            "description": "The date the customer had requested, pre-formatted.",
            "example": "Monday, July 21, 2026",
            "availability": "used"
          },
          {
            "path": "requestedTime",
            "type": "string",
            "description": "The time the customer had requested, pre-formatted.",
            "example": "2:00 PM EDT",
            "availability": "used"
          },
          {
            "path": "referenceNumber",
            "type": "string",
            "description": "Reference code for the original request.",
            "example": "A1B2C3D4",
            "availability": "used",
            "notes": "Derived from first 8 chars of appointment_request_id, uppercased (line 1515). Verified accurate - this template is only sent from the management action, so no 'APT-' variant applies here."
          },
          {
            "path": "declineReason",
            "type": "string",
            "description": "Optional explanation of why the request could not be accommodated.",
            "example": "The requested time is fully booked.",
            "availability": "used",
            "notes": "Optional. Reason box shown only inside {{#if declineReason}}."
          },
          {
            "path": "requestNewAppointmentLink",
            "type": "url",
            "description": "Link where the customer can submit a new appointment request.",
            "example": "https://app.algapsa.com/client-portal/appointments/new",
            "availability": "used",
            "notes": "Optional. 'Request Another Time' button shown only inside {{#if requestNewAppointmentLink}}."
          },
          {
            "path": "contactEmail",
            "type": "string",
            "description": "Support email for help finding an available time.",
            "example": "support@acme-it.com",
            "availability": "used"
          },
          {
            "path": "contactPhone",
            "type": "string",
            "description": "Support phone number, shown only when provided.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if contactPhone}}."
          },
          {
            "path": "requesterEmail",
            "type": "string",
            "description": "Customer's email address (used as the send-to address).",
            "example": "jane.smith@client.com",
            "availability": "available-unused",
            "notes": "Assembled (used as recipient) but not referenced in the template body."
          }
        ]
      },
      {
        "templateName": "appointment-assigned-technician",
        "variables": [
          {
            "path": "technicianName",
            "type": "string",
            "description": "Name of the technician being notified of their new assignment (first_name + last_name).",
            "example": "John Doe",
            "availability": "used",
            "notes": "Required. Used in greeting."
          },
          {
            "path": "serviceName",
            "type": "string",
            "description": "Name of the service for the assigned appointment.",
            "example": "Network Assessment",
            "availability": "used"
          },
          {
            "path": "appointmentDate",
            "type": "string",
            "description": "Assigned appointment date, pre-formatted.",
            "example": "Monday, July 21, 2026",
            "availability": "used"
          },
          {
            "path": "appointmentTime",
            "type": "string",
            "description": "Assigned appointment time, pre-formatted (technician timezone).",
            "example": "2:00 PM EDT",
            "availability": "used"
          },
          {
            "path": "duration",
            "type": "number",
            "description": "Assigned appointment length in minutes.",
            "example": "60",
            "availability": "used"
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "Name of the client the appointment is for (client_name, falling back to the requester name).",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Optional. Client box shown only inside {{#if clientName}}."
          },
          {
            "path": "description",
            "type": "string",
            "description": "Appointment notes for the technician.",
            "example": "Customer reports intermittent VPN drops; bring spare firewall.",
            "availability": "used",
            "notes": "Optional. Notes box shown only inside {{#if description}}."
          },
          {
            "path": "onlineMeetingUrl",
            "type": "url",
            "description": "Microsoft Teams join link when the appointment is an online meeting.",
            "example": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123",
            "availability": "used",
            "notes": "Optional. 'Join Teams Meeting' button shown only inside {{#if onlineMeetingUrl}}."
          },
          {
            "path": "calendarLink",
            "type": "url",
            "description": "Link to download the appointment as an ICS calendar file.",
            "example": "https://app.algapsa.com/api/appointments/ics/abc123",
            "availability": "used",
            "notes": "Optional. 'Add to Calendar' button shown only inside {{#if calendarLink}}."
          },
          {
            "path": "contactEmail",
            "type": "string",
            "description": "Internal support/contact email for questions about the assignment.",
            "example": "dispatch@acme-it.com",
            "availability": "used"
          },
          {
            "path": "contactPhone",
            "type": "string",
            "description": "Contact phone number, shown only when provided.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Optional. Used only inside {{#if contactPhone}}."
          },
          {
            "path": "technicianEmail",
            "type": "string",
            "description": "Assigned technician's email address (used as the send-to address).",
            "example": "john.doe@acme-it.com",
            "availability": "available-unused",
            "notes": "Required in the data interface but not referenced in the shipped template."
          }
        ]
      },
      {
        "templateName": "new-appointment-request",
        "variables": [
          {
            "path": "clientName",
            "type": "string",
            "description": "Name of the client the request is associated with; also used in the subject and header.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Optional in interface but referenced unconditionally in subject/header; a row is also shown inside {{#if clientName}} in the requester block. Public route falls back to the literal 'Public Request' when no company is given (route.ts 360); portal supplies the client company name."
          },
          {
            "path": "serviceName",
            "type": "string",
            "description": "Name of the requested service.",
            "example": "Network Assessment",
            "availability": "used",
            "notes": "Used unconditionally in the body table and inside {{#if serviceName}} in the subject."
          },
          {
            "path": "requesterName",
            "type": "string",
            "description": "Name of the person who submitted the request.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Required."
          },
          {
            "path": "requesterEmail",
            "type": "string",
            "description": "Email address of the requester.",
            "example": "jane.smith@client.com",
            "availability": "used",
            "notes": "Required."
          },
          {
            "path": "requesterPhone",
            "type": "string",
            "description": "Phone number of the requester, shown only when provided.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Optional. Shown only inside {{#if requesterPhone}}. Only supplied by the public route; the portal call site omits it."
          },
          {
            "path": "companyName",
            "type": "string",
            "description": "Company the requester belongs to, shown only when provided.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Optional. Shown only inside {{#if companyName}}. Only supplied by the public route; the portal call site omits it."
          },
          {
            "path": "referenceNumber",
            "type": "string",
            "description": "Reference code for the new request.",
            "example": "A1B2C3D4",
            "availability": "used",
            "notes": "Referenced via the referenceMsg copy string in html and text. Format differs by call site: public route uses generateReferenceNumber() = 'APT-<timestamp>-<random>'; portal uses the 8-char uppercased id slice (example shown)."
          },
          {
            "path": "requestedDate",
            "type": "string",
            "description": "The date the customer requested, pre-formatted.",
            "example": "Monday, July 21, 2026",
            "availability": "used"
          },
          {
            "path": "requestedTime",
            "type": "string",
            "description": "The time the customer requested, pre-formatted with a parenthesized staff-timezone label.",
            "example": "2:00 PM (EDT)",
            "availability": "used"
          },
          {
            "path": "duration",
            "type": "number",
            "description": "Requested appointment length in minutes.",
            "example": "60",
            "availability": "used"
          },
          {
            "path": "preferredTechnician",
            "type": "string",
            "description": "Technician the customer requested by preference; defaults to 'Not specified'.",
            "example": "John Doe",
            "availability": "used",
            "notes": "Optional. Row shown only inside {{#if preferredTechnician}}. Both call sites pass the resolved name or the literal 'Not specified'."
          },
          {
            "path": "description",
            "type": "string",
            "description": "Additional notes the customer provided with the request.",
            "example": "Prefer morning; two workstations affected.",
            "availability": "used",
            "notes": "Optional. Notes box shown only inside {{#if description}}. Only supplied by the public route; the portal call site omits it."
          },
          {
            "path": "approvalLink",
            "type": "url",
            "description": "Link for MSP staff to review and approve the request.",
            "example": "https://app.algapsa.com/msp/schedule",
            "availability": "used",
            "notes": "Optional. 'Review & Approve' button shown only inside {{#if approvalLink}}. Both call sites set it to `${NEXT_PUBLIC_APP_URL}/msp/schedule`."
          },
          {
            "path": "submittedAt",
            "type": "string",
            "description": "Timestamp when the request was submitted.",
            "example": "2026-07-17T14:03:00.000Z",
            "availability": "available-unused",
            "notes": "Assembled (ISO string via toISOString() from public route line 368; locale string via toLocaleString() from portal action line 703) but not referenced in the template."
          },
          {
            "path": "linkedTicket",
            "type": "string",
            "description": "Reference to a ticket linked to the request, if any.",
            "example": "TCK-1234",
            "availability": "available-unused",
            "notes": "Declared optional in NewAppointmentRequestData but never assembled at either call site; not referenced in the template."
          },
          {
            "path": "isAuthenticated",
            "type": "boolean",
            "description": "Whether the request came from a signed-in client-portal user (true) or a public form (false).",
            "example": "true",
            "availability": "available-unused",
            "notes": "Assembled (false from public route line 369, true from portal line 704) but not wired into the rendered body (only unused textTypeAuth/textTypePublic copy strings exist)."
          },
          {
            "path": "portalLink",
            "type": "url",
            "description": "URL to the relevant portal area.",
            "example": "https://app.algapsa.com/msp/schedule",
            "availability": "available-unused",
            "notes": "Declared optional in NewAppointmentRequestData but never assembled at either call site; not referenced in the template."
          },
          {
            "path": "contactEmail",
            "type": "string",
            "description": "Support/contact email address.",
            "example": "support@acme-it.com",
            "availability": "available-unused",
            "notes": "Assembled at both call sites but not referenced in this staff-facing template."
          },
          {
            "path": "contactPhone",
            "type": "string",
            "description": "Support/contact phone number.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused",
            "notes": "Optional; assembled at both call sites but not referenced in this template."
          }
        ]
      }
    ]
  },
  {
    "category": "auth",
    "templates": [
      {
        "templateName": "email-verification",
        "variables": [
          {
            "path": "registrationClientName",
            "type": "string",
            "description": "Name of the client/company the person is registering for; shown in the subject and intro when present.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Assembled at send time from the 'clients' table (client_name). Also used as an {{#if}} condition in subject and intro."
          },
          {
            "path": "verificationUrl",
            "type": "url",
            "description": "The link the recipient clicks to verify their email address and activate the account.",
            "example": "https://app.example.com/auth/verify?token=sample-token&registrationId=reg-789",
            "availability": "used",
            "notes": "Built as `${NEXT_PUBLIC_APP_URL}/auth/verify?token=...&registrationId=...`. Appears in the button href, the copy-paste link box, and the text version."
          },
          {
            "path": "tenantClientName",
            "type": "string",
            "description": "The service provider (MSP tenant) name shown in the copyright footer.",
            "example": "Wolf River IT",
            "availability": "used",
            "notes": "Assembled at send time from the 'tenants' table (client_name). Used only in the footer copyright line alongside currentYear."
          },
          {
            "path": "currentYear",
            "type": "number",
            "description": "The current calendar year, shown in the copyright footer.",
            "example": "2026",
            "availability": "used",
            "notes": "Set to new Date().getFullYear() at send time."
          },
          {
            "path": "expirationTime",
            "type": "string",
            "description": "Human-readable window before the verification link expires (drives a time-sensitive warning box).",
            "example": "48 hours",
            "availability": "used",
            "notes": "Referenced in the template ({{#if expirationTime}} warning block and text warning), but NOT included in the templateData assembled in sendVerificationEmail.ts, so at real send time the warning block renders empty/omitted. Only supplied by the preview sample data."
          },
          {
            "path": "email",
            "type": "string",
            "description": "The recipient's email address being verified.",
            "example": "jane.doe@acme.com",
            "availability": "available-unused",
            "notes": "Included in the send-time templateData but not referenced anywhere in the shipped email-verification template."
          }
        ]
      },
      {
        "templateName": "no-account-found",
        "variables": [
          {
            "path": "platformName",
            "type": "string",
            "description": "The portal/product name shown in the subject, header banner, and footer.",
            "example": "Client Portal",
            "availability": "used",
            "notes": "Assembled in generateNoAccountEmailContent() as process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Client Portal'."
          },
          {
            "path": "currentYear",
            "type": "number",
            "description": "The current calendar year, shown in the copyright footer.",
            "example": "2026",
            "availability": "used",
            "notes": "Set to new Date().getFullYear() at send time."
          }
        ]
      },
      {
        "templateName": "password-reset",
        "variables": [
          {
            "path": "userName",
            "type": "string",
            "description": "The recipient's display name, used in the greeting line.",
            "example": "John Doe",
            "availability": "used",
            "notes": "Passed in by the caller of sendPasswordResetEmail."
          },
          {
            "path": "email",
            "type": "string",
            "description": "The account email the password reset applies to; shown in the intro, the security-check box, and the footer.",
            "example": "john.doe@example.com",
            "availability": "used",
            "notes": "Referenced multiple times (intro, security box account email, footer 'sent to' line)."
          },
          {
            "path": "resetLink",
            "type": "url",
            "description": "The link the recipient clicks to set a new password.",
            "example": "https://app.example.com/auth/reset-password?token=sample-token",
            "availability": "used",
            "notes": "Used in the button href, copy-paste link box, and text reset prompt."
          },
          {
            "path": "expirationTime",
            "type": "string",
            "description": "Human-readable window before the reset link expires (e.g. valid-for and warning copy).",
            "example": "24 hours",
            "availability": "used",
            "notes": "Appears in the security box 'valid for', the warning list, and the text version."
          },
          {
            "path": "supportEmail",
            "type": "string",
            "description": "Support contact email shown in the Need Help section (also set as the email Reply-To).",
            "example": "support@example.com",
            "availability": "used",
            "notes": "Used in helpContact and text help. Also passed as replyTo on the outgoing email."
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "The organization name shown in the copyright footer.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Used only in the footer copyright line alongside currentYear."
          },
          {
            "path": "currentYear",
            "type": "number",
            "description": "The current calendar year, shown in the copyright footer.",
            "example": "2026",
            "availability": "used",
            "notes": "Set to new Date().getFullYear() at send time."
          }
        ]
      },
      {
        "templateName": "portal-invitation",
        "variables": [
          {
            "path": "contactName",
            "type": "string",
            "description": "The invited contact's name, used in the greeting and footer.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Used in greeting and the footer 'this email was sent to' line."
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "The client/company whose customer portal the recipient is being invited to.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Used in subject, intro, and footer copyright. Also an {{#if clientName}} condition in the Polish subject."
          },
          {
            "path": "portalLink",
            "type": "url",
            "description": "The link the recipient clicks to set up their portal access.",
            "example": "https://app.example.com/auth/accept-invite?token=sample-token",
            "availability": "used",
            "notes": "Used in the button href, copy-paste link box, and text version."
          },
          {
            "path": "expirationTime",
            "type": "string",
            "description": "Human-readable window before the invitation link expires.",
            "example": "7 days",
            "availability": "used",
            "notes": "Used in the time-sensitive warning box and its text equivalent."
          },
          {
            "path": "clientLocationEmail",
            "type": "string",
            "description": "The client location's contact email, shown in the Need Assistance box and footer (also the email Reply-To).",
            "example": "support@acme.com",
            "availability": "used",
            "notes": "Defaults to 'Not provided' when the caller omits it. Used in contact-info Email, footerUnexpected, and text. Also passed as replyTo."
          },
          {
            "path": "clientLocationPhone",
            "type": "string",
            "description": "The client location's contact phone number, shown in the Need Assistance box.",
            "example": "+1 (555) 010-1234",
            "availability": "used",
            "notes": "Defaults to 'Not provided' when the caller omits it. Used in contact-info Phone and text."
          },
          {
            "path": "currentYear",
            "type": "number",
            "description": "The current calendar year, shown in the copyright footer.",
            "example": "2026",
            "availability": "used",
            "notes": "Set to new Date().getFullYear() at send time."
          }
        ]
      },
      {
        "templateName": "tenant-recovery",
        "variables": [
          {
            "path": "platformName",
            "type": "string",
            "description": "The portal/product name shown in the subject, header banner, and footer.",
            "example": "Client Portal",
            "availability": "used",
            "notes": "Assembled as process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Client Portal'."
          },
          {
            "path": "isMultiple",
            "type": "boolean",
            "description": "Whether the recipient's email is associated with more than one organization; toggles singular vs plural wording.",
            "example": "true",
            "availability": "used",
            "notes": "Computed as tenantLoginInfos.length > 1. Drives {{#if isMultiple}} pluralization and the 'we found N organizations' sentence throughout subject-body copy."
          },
          {
            "path": "tenantCount",
            "type": "number",
            "description": "How many organizations were found for the recipient's email address.",
            "example": "3",
            "availability": "used",
            "notes": "Computed as tenantLoginInfos.length. Interpolated only inside the {{#if isMultiple}} branch."
          },
          {
            "path": "tenantLinksHtml",
            "type": "string",
            "description": "Pre-rendered HTML table rows, one per organization, each with the org name and a Sign In button.",
            "example": "<tr><td>...Sign In to Acme Corporation...</td></tr>",
            "availability": "used",
            "notes": "Raw HTML block generated by generateTenantLinksHtml() and injected into the table body."
          },
          {
            "path": "tenantLinksText",
            "type": "string",
            "description": "Plain-text list of organizations and their login URLs, for the text version of the email.",
            "example": "1. Acme Corporation\n   Login URL: https://acme.portal.example.com/login",
            "availability": "used",
            "notes": "Generated by generateTenantLinksText(); used in the text body only."
          },
          {
            "path": "currentYear",
            "type": "number",
            "description": "The current calendar year, shown in the copyright footer.",
            "example": "2026",
            "availability": "used",
            "notes": "Set to new Date().getFullYear() at send time."
          }
        ]
      }
    ]
  },
  {
    "category": "billing",
    "templates": [
      {
        "templateName": "credit-expiring",
        "variables": [
          {
            "path": "company.name",
            "type": "string",
            "description": "The client/company name shown in the subject line and email body as the account the expiring credits belong to.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Referenced throughout the template (subject, header title, intro, company row, text body) but NOT provided under a `company` key at send time — the subscriber supplies the name on `client.name` instead. See uncertainties."
          },
          {
            "path": "client.name",
            "type": "string",
            "description": "The name of the client whose credits are expiring.",
            "example": "Acme Corporation",
            "availability": "available-unused",
            "notes": "Assembled at send time (templateData.client.name from clients.name) and present in sample data, but the template references {{company.name}} rather than {{client.name}}."
          },
          {
            "path": "client.id",
            "type": "string",
            "description": "Internal identifier of the client whose credits are expiring.",
            "example": "client-001",
            "availability": "available-unused",
            "notes": "Assembled at send time from clients.client_id; also present in sample data. Not referenced by the template."
          },
          {
            "path": "credits.totalAmount",
            "type": "string",
            "description": "The total value of all credits that are about to expire, pre-formatted as currency.",
            "example": "$2,500.00",
            "availability": "used",
            "notes": "formatCurrency of the summed credit amounts."
          },
          {
            "path": "credits.expirationDate",
            "type": "string",
            "description": "The date the credits expire, pre-formatted for display.",
            "example": "March 31, 2026",
            "availability": "used",
            "notes": "formatDate of the first credit's expirationDate."
          },
          {
            "path": "credits.daysRemaining",
            "type": "number",
            "description": "How many days remain until the credits expire.",
            "example": "30",
            "availability": "used",
            "notes": "Passed through from the event payload's daysBeforeExpiration (a number); sample data renders it as the string '30'."
          },
          {
            "path": "credits.items",
            "type": "array",
            "description": "The line-by-line list of individual credits that are expiring, shown as a table.",
            "example": "[{ creditId: 'CR-1001', amount: '$1,500.00', expirationDate: 'March 31, 2026', transactionId: 'TX-9001' }]",
            "availability": "used",
            "notes": "Iterated with {{#each credits.items}} in both HTML and text."
          },
          {
            "path": "credits.items.creditId",
            "type": "string",
            "description": "Identifier of an individual expiring credit.",
            "example": "CR-1001",
            "availability": "used",
            "notes": "Rendered as {{this.creditId}} inside the each block."
          },
          {
            "path": "credits.items.amount",
            "type": "string",
            "description": "The value of an individual expiring credit, pre-formatted as currency.",
            "example": "$1,500.00",
            "availability": "used",
            "notes": "formatCurrency of the per-credit amount; rendered as {{this.amount}}."
          },
          {
            "path": "credits.items.expirationDate",
            "type": "string",
            "description": "The expiration date of an individual credit, pre-formatted for display.",
            "example": "March 31, 2026",
            "availability": "used",
            "notes": "formatDate of the per-credit expirationDate; rendered as {{this.expirationDate}}."
          },
          {
            "path": "credits.items.transactionId",
            "type": "string",
            "description": "Identifier of the original transaction that created this credit.",
            "example": "TX-9001",
            "availability": "used",
            "notes": "Resolved from credit_tracking.transaction_id; rendered as {{this.transactionId}}. May be undefined if no matching credit_tracking row exists."
          },
          {
            "path": "credits.items.description",
            "type": "string",
            "description": "Human-readable description of the original transaction that created the credit.",
            "example": "Overpayment refund on invoice INV-2043",
            "availability": "available-unused",
            "notes": "Assembled at send time (transactionMap[transactionId]?.description || 'N/A') but not referenced by the template."
          },
          {
            "path": "credits.url",
            "type": "url",
            "description": "Link to the client's credits page in the app where the expiring credits can be viewed and used.",
            "example": "https://app.example.com/billing/credits?client=client-001",
            "availability": "used",
            "notes": "Built as `${APP_URL}/billing/credits?client=${clientId}`; used in the HTML button href and the text footer."
          }
        ]
      }
    ]
  },
  {
    "category": "invoices",
    "templates": [
      {
        "templateName": "invoice-email",
        "variables": [
          {
            "path": "invoice.number",
            "type": "string",
            "description": "The invoice's human-readable number as shown to the client.",
            "example": "INV-000123",
            "availability": "used",
            "notes": "Used in subject, header title, body detail row, and plain-text. From invoice.invoice_number."
          },
          {
            "path": "invoice.amount",
            "type": "string",
            "description": "Total amount due on the invoice, pre-formatted as a currency string.",
            "example": "$1,250.00",
            "availability": "used",
            "notes": "formatCurrency((total_amount - credit_applied)/100) in the invoice currency."
          },
          {
            "path": "invoice.invoiceDate",
            "type": "date-string",
            "description": "The date the invoice was issued, formatted for display.",
            "example": "July 10, 2026",
            "availability": "used",
            "notes": "Falls back to 'N/A' when the invoice has no invoice_date."
          },
          {
            "path": "invoice.dueDate",
            "type": "date-string",
            "description": "The date payment is due, formatted for display.",
            "example": "August 9, 2026",
            "availability": "used",
            "notes": "Falls back to 'N/A' when the invoice has no due_date."
          },
          {
            "path": "recipient.name",
            "type": "string",
            "description": "Name of the person the invoice email is addressed to (billing contact or client).",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Billing contact full_name if present, otherwise the client name."
          },
          {
            "path": "company.name",
            "type": "string",
            "description": "The MSP's own company name, shown as the sender in subject, intro, and signature.",
            "example": "Contoso IT Services",
            "availability": "used",
            "notes": "From tenants.company_name, defaults to 'Your Company'."
          },
          {
            "path": "customMessage",
            "type": "string",
            "description": "Optional free-text note from the MSP shown in a highlighted box; the box is hidden when empty.",
            "example": "Thanks for your continued business — please note our new remittance address.",
            "availability": "used",
            "notes": "Passed as an argument to sendInvoiceEmailAction; defaults to '' (empty) so the {{#if}} block is omitted."
          },
          {
            "path": "recipient.email",
            "type": "string",
            "description": "Email address the invoice is being sent to.",
            "example": "jane.smith@acme.com",
            "availability": "available-unused",
            "notes": "Assembled in templateContext but not referenced in the shipped template body/subject."
          },
          {
            "path": "client.name",
            "type": "string",
            "description": "The client (customer) company being billed.",
            "example": "Acme Corporation",
            "availability": "available-unused",
            "notes": "Assembled in templateContext (client.name) but the template uses company.name and recipient.name instead."
          }
        ]
      },
      {
        "templateName": "invoice-generated",
        "variables": [
          {
            "path": "invoice.number",
            "type": "string",
            "description": "The newly generated invoice's number.",
            "example": "INV-000123",
            "availability": "used",
            "notes": "Used in subject, header title, badge, and text."
          },
          {
            "path": "invoice.amount",
            "type": "string",
            "description": "Invoice total, expected as a pre-formatted currency string.",
            "example": "$1,250.00",
            "availability": "used"
          },
          {
            "path": "invoice.dueDate",
            "type": "date-string",
            "description": "Date the invoice payment is due, formatted for display.",
            "example": "August 9, 2026",
            "availability": "used"
          },
          {
            "path": "invoice.clientName",
            "type": "string",
            "description": "The client the invoice was generated for.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Used in header meta line and the body 'Client' row."
          },
          {
            "path": "invoice.url",
            "type": "url",
            "description": "Link to view the invoice in the app; target of the 'View Invoice' button.",
            "example": "https://app.example.com/msp/billing/invoices/inv-001",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "payment-overdue",
        "variables": [
          {
            "path": "invoice.number",
            "type": "string",
            "description": "The overdue invoice's number.",
            "example": "INV-000123",
            "availability": "used",
            "notes": "Used in subject, intro sentence, header title, badge, and text."
          },
          {
            "path": "invoice.clientName",
            "type": "string",
            "description": "The client whose payment is overdue.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Used in the header meta line."
          },
          {
            "path": "invoice.amountDue",
            "type": "string",
            "description": "Outstanding amount still owed, expected as a pre-formatted currency string.",
            "example": "$1,250.00",
            "availability": "used"
          },
          {
            "path": "invoice.dueDate",
            "type": "date-string",
            "description": "Date the payment was originally due.",
            "example": "July 1, 2026",
            "availability": "used"
          },
          {
            "path": "invoice.daysOverdue",
            "type": "number",
            "description": "How many days past the due date the invoice is.",
            "example": "14",
            "availability": "used",
            "notes": "Rendered as text; likely a number or numeric string."
          },
          {
            "path": "invoice.url",
            "type": "url",
            "description": "Link to view the invoice in the app; target of the 'View Invoice' button.",
            "example": "https://app.example.com/msp/billing/invoices/inv-001",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "payment-received",
        "variables": [
          {
            "path": "invoice.number",
            "type": "string",
            "description": "The invoice the payment was applied to.",
            "example": "INV-000123",
            "availability": "used",
            "notes": "Used in subject, intro sentence, header title, badge, and text."
          },
          {
            "path": "invoice.clientName",
            "type": "string",
            "description": "The client who made the payment.",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Used in the header meta line."
          },
          {
            "path": "invoice.amountPaid",
            "type": "string",
            "description": "Amount received, expected as a pre-formatted currency string.",
            "example": "$1,250.00",
            "availability": "used"
          },
          {
            "path": "invoice.paymentDate",
            "type": "date-string",
            "description": "Date the payment was received.",
            "example": "July 15, 2026",
            "availability": "used"
          },
          {
            "path": "invoice.paymentMethod",
            "type": "string",
            "description": "How the payment was made.",
            "example": "Credit Card",
            "availability": "used"
          },
          {
            "path": "invoice.url",
            "type": "url",
            "description": "Link to view the invoice in the app; target of the 'View Invoice' button.",
            "example": "https://app.example.com/msp/billing/invoices/inv-001",
            "availability": "used"
          }
        ]
      }
    ]
  },
  {
    "category": "opportunities",
    "templates": [
      {
        "templateName": "opportunity-weekly-digest",
        "variables": [
          {
            "path": "digest.actionsDue",
            "type": "number",
            "description": "How many open opportunities owned by this rep have a next-action date falling within the current week",
            "example": "4",
            "availability": "used",
            "notes": "Assembled at send time as a raw number (weeklyDigest.ts line 119); query filters next_action_due within [startOfThisWeek, startOfNextWeek). The parallel in-app notification path passes the same value stringified in a flattened data object, but the email compilation receives the raw number."
          },
          {
            "path": "digest.stalledDeals",
            "type": "number",
            "description": "How many of this rep's open opportunities have gone untouched past the configured nudge window (last_activity_at at or before the stalled cutoff)",
            "example": "2",
            "availability": "used",
            "notes": "Stalled cutoff = now minus nudge_days*24 hours, derived from opportunity settings nudge_days (weeklyDigest.ts line 31, 53)."
          },
          {
            "path": "digest.newSuggestions",
            "type": "number",
            "description": "Count of pending opportunity_suggestions created since the start of last week (no upper bound, so it spans roughly one-to-two weeks up to now); tenant-wide, the same value for every recipient",
            "example": "5",
            "availability": "used",
            "notes": "This count is not per-owner; it is a single tenant-wide pending-suggestion count reused for all recipients (weeklyDigest.ts lines 65-69, 80, 90). Query is created_at >= startOfLastWeek with NO upper bound."
          },
          {
            "path": "digest.winsLastWeek",
            "type": "number",
            "description": "How many of this rep's opportunities were marked won during the previous week (won_at within [startOfLastWeek, startOfThisWeek))",
            "example": "1",
            "availability": "used"
          },
          {
            "path": "digest.url",
            "type": "url",
            "description": "Deep link to the rep's opportunity queue in the app",
            "example": "https://app.example.com/msp/opportunities",
            "availability": "used",
            "notes": "Built from APP_URL (or NEXTAUTH_URL fallback) with any trailing slash stripped, plus the fixed path /msp/opportunities (weeklyDigest.ts lines 81-82, 123). If neither env var is set the base is empty, yielding just /msp/opportunities."
          }
        ]
      }
    ]
  },
  {
    "category": "projects",
    "templates": [
      {
        "templateName": "milestone-completed",
        "variables": [
          {
            "path": "milestone.name",
            "type": "string",
            "description": "Name of the project milestone that was completed",
            "example": "Phase 1 Sign-off",
            "availability": "used"
          },
          {
            "path": "milestone.completedDate",
            "type": "date-string",
            "description": "Date the milestone was marked complete",
            "example": "Jul 15, 2026",
            "availability": "used"
          },
          {
            "path": "milestone.completedBy",
            "type": "string",
            "description": "Name of the person who completed the milestone",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the project the milestone belongs to",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "project.progress",
            "type": "number",
            "description": "Overall project completion percentage (rendered with a trailing % sign)",
            "example": "65",
            "availability": "used"
          },
          {
            "path": "project.url",
            "type": "url",
            "description": "Link to open the project",
            "example": "https://app.example.com/msp/projects/sample-project-id",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "project-assigned",
        "variables": [
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the project the recipient was assigned to",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "project.description",
            "type": "string",
            "description": "Plain-text project description (BlockNote content flattened to text via formatBlockNoteContent)",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "used"
          },
          {
            "path": "project.startDate",
            "type": "date-string",
            "description": "Project start date (projects.start_date; raw DB value, not pre-formatted)",
            "example": "2026-05-01",
            "availability": "used"
          },
          {
            "path": "project.assignedBy",
            "type": "string",
            "description": "Name of the person who assigned the project, resolved from the assigner user's first+last name (falls back to 'Someone')",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "project.url",
            "type": "url",
            "description": "MSP link to open the assigned project (always the internal /msp/projects URL — this handler does not build a client-portal variant)",
            "example": "https://app.example.com/msp/projects/sample-project-id",
            "availability": "used"
          },
          {
            "path": "project.descriptionText",
            "type": "string",
            "description": "Plain-text project description (same value as project.description)",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "available-unused"
          },
          {
            "path": "project.descriptionHtml",
            "type": "string",
            "description": "HTML-rendered project description",
            "example": "<p>Roll out new endpoint protection to all client sites.</p>",
            "availability": "available-unused"
          },
          {
            "path": "project.client",
            "type": "string",
            "description": "Name of the client the project belongs to (falls back to 'No Client')",
            "example": "Acme Corporation",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "project-closed",
        "variables": [
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the closed project",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "project.status",
            "type": "string",
            "description": "Current status label of the project (falls back to 'Unknown')",
            "example": "Closed",
            "availability": "used"
          },
          {
            "path": "project.closedBy",
            "type": "string",
            "description": "Name of the person who closed the project (resolved from the actor user id via resolveValue; falls back to the raw id/'None')",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "project.changes",
            "type": "string",
            "description": "Pre-rendered HTML fragment listing the field changes applied when closing (rendered raw via triple-stache in HTML, and as plain text in the text body)",
            "example": "<ul style=\"margin:0;padding:0;list-style:none;\">...</ul>",
            "availability": "used"
          },
          {
            "path": "project.url",
            "type": "url",
            "description": "Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user)",
            "example": "https://app.example.com/msp/projects/sample-project-id",
            "availability": "used"
          },
          {
            "path": "project.id",
            "type": "string",
            "description": "Human-readable project number (projects.project_number)",
            "example": "PRJ-0042",
            "availability": "available-unused"
          },
          {
            "path": "project.manager",
            "type": "string",
            "description": "Name of the project manager (falls back to 'Unassigned')",
            "example": "Jane Smith",
            "availability": "available-unused"
          },
          {
            "path": "project.description",
            "type": "string",
            "description": "Plain-text project description",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "available-unused"
          },
          {
            "path": "project.descriptionText",
            "type": "string",
            "description": "Plain-text project description (same value as project.description)",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "available-unused"
          },
          {
            "path": "project.descriptionHtml",
            "type": "string",
            "description": "HTML-rendered project description",
            "example": "<p>Roll out new endpoint protection to all client sites.</p>",
            "availability": "available-unused"
          },
          {
            "path": "project.startDate",
            "type": "date-string",
            "description": "Project start date",
            "example": "2026-05-01",
            "availability": "available-unused"
          },
          {
            "path": "project.endDate",
            "type": "date-string",
            "description": "Project end date",
            "example": "2026-07-15",
            "availability": "available-unused"
          },
          {
            "path": "project.closedAt",
            "type": "date-string",
            "description": "ISO timestamp when the project was closed (new Date().toISOString() at send time)",
            "example": "2026-07-17T14:30:00.000Z",
            "availability": "available-unused"
          },
          {
            "path": "project.client",
            "type": "string",
            "description": "Name of the client the project belongs to (falls back to 'No Client')",
            "example": "Acme Corporation",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "project-created",
        "variables": [
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the newly created project",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "project.description",
            "type": "string",
            "description": "Plain-text project description (BlockNote content flattened to text)",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "used"
          },
          {
            "path": "project.startDate",
            "type": "date-string",
            "description": "Project start date",
            "example": "2026-05-01",
            "availability": "used"
          },
          {
            "path": "project.manager",
            "type": "string",
            "description": "Name of the project manager (falls back to 'Unassigned')",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "project.url",
            "type": "url",
            "description": "Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user)",
            "example": "https://app.example.com/msp/projects/sample-project-id",
            "availability": "used"
          },
          {
            "path": "project.id",
            "type": "string",
            "description": "Human-readable project number (projects.project_number)",
            "example": "PRJ-0042",
            "availability": "available-unused"
          },
          {
            "path": "project.descriptionText",
            "type": "string",
            "description": "Plain-text project description (same value as project.description)",
            "example": "Roll out new endpoint protection to all client sites.",
            "availability": "available-unused"
          },
          {
            "path": "project.descriptionHtml",
            "type": "string",
            "description": "HTML-rendered project description",
            "example": "<p>Roll out new endpoint protection to all client sites.</p>",
            "availability": "available-unused"
          },
          {
            "path": "project.status",
            "type": "string",
            "description": "Current status label of the project (falls back to 'Unknown')",
            "example": "Planning",
            "availability": "available-unused"
          },
          {
            "path": "project.endDate",
            "type": "date-string",
            "description": "Project end date",
            "example": "2026-07-15",
            "availability": "available-unused"
          },
          {
            "path": "project.createdBy",
            "type": "string",
            "description": "User ID of the actor who created the project (raw ID, not a display name)",
            "example": "user-123",
            "availability": "available-unused"
          },
          {
            "path": "project.client",
            "type": "string",
            "description": "Name of the client the project belongs to (falls back to 'No Client')",
            "example": "Acme Corporation",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "project-task-assigned-additional",
        "variables": [
          {
            "path": "task.name",
            "type": "string",
            "description": "Name of the task the recipient was added to",
            "example": "Configure firewall rules",
            "availability": "used"
          },
          {
            "path": "task.project",
            "type": "string",
            "description": "Name of the project the task belongs to",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "task.dueDate",
            "type": "date-string",
            "description": "Task due date (project_tasks.due_date; row only shown when present)",
            "example": "2026-06-30",
            "availability": "used"
          },
          {
            "path": "task.assignedBy",
            "type": "string",
            "description": "Name of the person who assigned the task, from the event payload assignedByName (falls back to 'Someone'); row only shown when present",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "task.role",
            "type": "string",
            "description": "Recipient's role on the task; set to 'Additional Agent' at send time (row only shown when present)",
            "example": "Additional Agent",
            "availability": "used"
          },
          {
            "path": "task.url",
            "type": "url",
            "description": "MSP link to open the task within the project view",
            "example": "https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1",
            "availability": "used"
          },
          {
            "path": "task.description",
            "type": "string",
            "description": "Task description shown in a highlighted box when present; referenced by the template but NOT supplied by the send-time context, so it always renders empty/omitted",
            "example": "Apply the standard firewall baseline to all edge devices.",
            "availability": "used"
          },
          {
            "path": "recipientName",
            "type": "string",
            "description": "Recipient's display name used in the greeting when present; referenced by the template but NOT supplied by the send-time context, so the greeting renders without a name",
            "example": "Jane Smith",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "project-task-assigned-primary",
        "variables": [
          {
            "path": "task.name",
            "type": "string",
            "description": "Name of the task the recipient was assigned to",
            "example": "Configure firewall rules",
            "availability": "used"
          },
          {
            "path": "task.project",
            "type": "string",
            "description": "Name of the project the task belongs to",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "task.dueDate",
            "type": "date-string",
            "description": "Task due date (project_tasks.due_date; row only shown when present)",
            "example": "2026-06-30",
            "availability": "used"
          },
          {
            "path": "task.assignedBy",
            "type": "string",
            "description": "Name of the person who assigned the task, from the event payload assignedByName (falls back to 'Someone'); row only shown when present",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "task.role",
            "type": "string",
            "description": "Recipient's role on the task; set to 'Primary Assignee' at send time (row only shown when present)",
            "example": "Primary Assignee",
            "availability": "used"
          },
          {
            "path": "task.url",
            "type": "url",
            "description": "MSP link to open the task within the project view",
            "example": "https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1",
            "availability": "used"
          },
          {
            "path": "task.description",
            "type": "string",
            "description": "Task description shown in a highlighted box when present; referenced by the template but NOT supplied by the send-time context, so it always renders empty/omitted",
            "example": "Apply the standard firewall baseline to all edge devices.",
            "availability": "used"
          },
          {
            "path": "recipientName",
            "type": "string",
            "description": "Recipient's display name used in the greeting when present; referenced by the template but NOT supplied by the send-time context, so the greeting renders without a name",
            "example": "Jane Smith",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "project-updated",
        "variables": [
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the updated project",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "project.status",
            "type": "string",
            "description": "Current status label of the project (falls back to 'Unknown')",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "project.updatedBy",
            "type": "string",
            "description": "Name of the person who updated the project (resolved from the actor user; falls back to the raw user ID)",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "project.changes",
            "type": "string",
            "description": "Pre-rendered HTML fragment listing the field changes (old vs new values); rendered raw via triple-stache in HTML and as plain text in the text body",
            "example": "<ul style=\"margin:0;padding:0;list-style:none;\">...</ul>",
            "availability": "used"
          },
          {
            "path": "project.url",
            "type": "url",
            "description": "Link to open the project (client-portal URL for external recipients, MSP URL for the assigned user)",
            "example": "https://app.example.com/msp/projects/sample-project-id",
            "availability": "used"
          },
          {
            "path": "project.id",
            "type": "string",
            "description": "Human-readable project number (projects.project_number)",
            "example": "PRJ-0042",
            "availability": "available-unused"
          },
          {
            "path": "project.manager",
            "type": "string",
            "description": "Name of the project manager (falls back to 'Unassigned')",
            "example": "Jane Smith",
            "availability": "available-unused"
          },
          {
            "path": "project.client",
            "type": "string",
            "description": "Name of the client the project belongs to (falls back to 'No Client')",
            "example": "Acme Corporation",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "task-comment-added",
        "variables": [
          {
            "path": "task.name",
            "type": "string",
            "description": "Name of the task the comment was added to",
            "example": "Configure firewall rules",
            "availability": "used"
          },
          {
            "path": "task.url",
            "type": "url",
            "description": "MSP link to open the task within the project view",
            "example": "https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1",
            "availability": "used"
          },
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the project the task belongs to",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "comment.author",
            "type": "string",
            "description": "Display name of the person who wrote the comment (falls back to 'Someone')",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "comment.contentHtml",
            "type": "string",
            "description": "HTML-rendered comment body (rendered raw via triple-stache in the HTML email)",
            "example": "<p>I have completed the firewall config, please review.</p>",
            "availability": "used"
          },
          {
            "path": "comment.contentText",
            "type": "string",
            "description": "Plain-text comment body used in the text email",
            "example": "I have completed the firewall config, please review.",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "task-updated",
        "variables": [
          {
            "path": "task.name",
            "type": "string",
            "description": "Name of the updated task",
            "example": "Configure firewall rules",
            "availability": "used"
          },
          {
            "path": "task.status",
            "type": "string",
            "description": "Current status label of the task",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "task.progress",
            "type": "number",
            "description": "Task completion percentage (rendered with a trailing % sign)",
            "example": "50",
            "availability": "used"
          },
          {
            "path": "task.updatedBy",
            "type": "string",
            "description": "Name of the person who updated the task",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "task.url",
            "type": "url",
            "description": "Link to open the task",
            "example": "https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1",
            "availability": "used"
          },
          {
            "path": "project.name",
            "type": "string",
            "description": "Name of the project the task belongs to",
            "example": "Q2 Rollout",
            "availability": "used"
          }
        ]
      }
    ]
  },
  {
    "category": "sla",
    "templates": [
      {
        "templateName": "sla-breach",
        "variables": [
          {
            "path": "recipientName",
            "type": "string",
            "description": "Name of the MSP staff member (assignee, board manager, or escalation manager) receiving this alert",
            "example": "John Doe",
            "availability": "used",
            "notes": "Assembled at send time as first_name + last_name of the recipient, falling back to 'there'. Passed only for the email channel (added in the recipient loop), not part of the base templateData."
          },
          {
            "path": "ticketNumber",
            "type": "string",
            "description": "Human-readable ticket number of the breached ticket",
            "example": "TCK-1234",
            "availability": "used",
            "notes": "Appears in subject, HTML badge, and text body."
          },
          {
            "path": "slaType",
            "type": "string",
            "description": "Which SLA clock was breached — Response or Resolution",
            "example": "Response",
            "availability": "used",
            "notes": "Derived from context.slaType ('response'|'resolution') and capitalized to 'Response'/'Resolution'. Appears in subject and body."
          },
          {
            "path": "ticketTitle",
            "type": "string",
            "description": "Title/summary of the breached ticket",
            "example": "Network connectivity issue in Building A",
            "availability": "used"
          },
          {
            "path": "timeOverdue",
            "type": "string",
            "description": "How long the ticket has been past its SLA target, human-formatted",
            "example": "15 minutes",
            "availability": "used",
            "notes": "Computed via formatRemainingTime(Math.abs(remainingMinutes)); the same formatted value is also assigned to remainingTime and timeRemaining."
          },
          {
            "path": "priority",
            "type": "string",
            "description": "Priority level of the ticket",
            "example": "High",
            "availability": "used",
            "notes": "Set from context.priorityName (falls back to 'Unknown'). Distinct field from priorityName but holds the same value."
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "Name of the client company the ticket belongs to",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Falls back to 'Unknown' when not provided."
          },
          {
            "path": "policyName",
            "type": "string",
            "description": "Name of the SLA policy that was breached",
            "example": "Critical Response SLA",
            "availability": "used",
            "notes": "Looked up from sla_policies.policy_name; falls back to 'Unknown'."
          },
          {
            "path": "ticketUrl",
            "type": "string",
            "description": "Relative link to open the ticket in the MSP app; the View Ticket button/link only renders when present",
            "example": "/msp/tickets/sample-ticket-id",
            "availability": "used",
            "notes": "Gated by {{#if ticketUrl}} in both HTML and text. Assembled as a relative path `/msp/tickets/{ticketId}`."
          },
          {
            "path": "priorityName",
            "type": "string",
            "description": "Priority level of the ticket (duplicate of priority)",
            "example": "High",
            "availability": "available-unused",
            "notes": "Assembled at send time but the shipped sla-breach template references only `priority`."
          },
          {
            "path": "thresholdPercent",
            "type": "number",
            "description": "SLA elapsed-time threshold percentage that triggered the notification (>=100 means breach)",
            "example": "100",
            "availability": "available-unused",
            "notes": "Used to decide breach vs warning at send time; not rendered in the breach template body."
          },
          {
            "path": "remainingTime",
            "type": "string",
            "description": "Formatted remaining/overdue time (duplicate of timeOverdue)",
            "example": "0 minutes",
            "availability": "available-unused"
          },
          {
            "path": "timeRemaining",
            "type": "string",
            "description": "Formatted remaining time (duplicate of timeOverdue for breach)",
            "example": "0 minutes",
            "availability": "available-unused",
            "notes": "Referenced by the sla-warning template but not sla-breach."
          },
          {
            "path": "dueAt",
            "type": "date-string",
            "description": "ISO timestamp of the SLA due date/time",
            "example": "2026-07-17T12:00:00.000Z",
            "availability": "available-unused",
            "notes": "context.dueAt.toISOString(); assembled but not rendered."
          }
        ]
      },
      {
        "templateName": "sla-warning",
        "variables": [
          {
            "path": "recipientName",
            "type": "string",
            "description": "Name of the MSP staff member responsible for the ticket receiving the warning",
            "example": "John Doe",
            "availability": "used",
            "notes": "Assembled per-recipient for the email channel (first_name + last_name, fallback 'there')."
          },
          {
            "path": "ticketNumber",
            "type": "string",
            "description": "Human-readable ticket number approaching its SLA deadline",
            "example": "TCK-1234",
            "availability": "used",
            "notes": "Appears in subject, HTML badge, and text body."
          },
          {
            "path": "thresholdPercent",
            "type": "number",
            "description": "Percentage of SLA time elapsed that triggered the warning",
            "example": "75",
            "availability": "used",
            "notes": "Appears in subject and header ('{{thresholdPercent}}% Time Elapsed'). Numeric value from context.thresholdPercent."
          },
          {
            "path": "ticketTitle",
            "type": "string",
            "description": "Title/summary of the ticket approaching breach",
            "example": "Network connectivity issue in Building A",
            "availability": "used"
          },
          {
            "path": "slaType",
            "type": "string",
            "description": "Which SLA clock is at risk — Response or Resolution",
            "example": "Resolution",
            "availability": "used",
            "notes": "Capitalized from context.slaType."
          },
          {
            "path": "timeRemaining",
            "type": "string",
            "description": "Time left before the SLA is breached, human-formatted",
            "example": "30 minutes",
            "availability": "used",
            "notes": "Same formatted value as timeOverdue/remainingTime, from formatRemainingTime(Math.abs(remainingMinutes))."
          },
          {
            "path": "priority",
            "type": "string",
            "description": "Priority level of the ticket",
            "example": "High",
            "availability": "used",
            "notes": "Set from context.priorityName, fallback 'Unknown'."
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "Name of the client company the ticket belongs to",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "Fallback 'Unknown'."
          },
          {
            "path": "ticketUrl",
            "type": "string",
            "description": "Relative link to open the ticket; View Ticket button/link renders only when present",
            "example": "/msp/tickets/sample-ticket-id",
            "availability": "used",
            "notes": "Gated by {{#if ticketUrl}} in HTML and text."
          },
          {
            "path": "priorityName",
            "type": "string",
            "description": "Priority level (duplicate of priority)",
            "example": "High",
            "availability": "available-unused"
          },
          {
            "path": "policyName",
            "type": "string",
            "description": "Name of the SLA policy in effect",
            "example": "Standard Resolution SLA",
            "availability": "available-unused",
            "notes": "Looked up from sla_policies.policy_name and assembled, but the sla-warning template does not render it (only sla-breach does)."
          },
          {
            "path": "remainingTime",
            "type": "string",
            "description": "Formatted remaining time (duplicate of timeRemaining)",
            "example": "30 minutes",
            "availability": "available-unused"
          },
          {
            "path": "timeOverdue",
            "type": "string",
            "description": "Formatted overdue/remaining time (duplicate of timeRemaining)",
            "example": "0 minutes",
            "availability": "available-unused",
            "notes": "Referenced by sla-breach, not sla-warning."
          },
          {
            "path": "dueAt",
            "type": "date-string",
            "description": "ISO timestamp of the SLA due date/time",
            "example": "2026-07-17T12:00:00.000Z",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "sla-escalation",
        "variables": [
          {
            "path": "recipientName",
            "type": "string",
            "description": "Name of the escalation manager the ticket was escalated to",
            "example": "John Doe",
            "availability": "used",
            "notes": "Assembled in sendEscalationEmailNotification from the recipient user's first_name + last_name, falling back to 'Team Member'."
          },
          {
            "path": "ticketNumber",
            "type": "string",
            "description": "Human-readable ticket number that was escalated",
            "example": "TCK-1234",
            "availability": "used",
            "notes": "Appears in subject, HTML badge, and text body."
          },
          {
            "path": "escalationLevel",
            "type": "number",
            "description": "Escalation tier the ticket was raised to (1, 2, or 3)",
            "example": "2",
            "availability": "used",
            "notes": "Numeric level passed through from escalateTicket. Appears in subject, header, and body ('Level {{escalationLevel}}')."
          },
          {
            "path": "ticketTitle",
            "type": "string",
            "description": "Title/summary of the escalated ticket",
            "example": "Critical server outage",
            "availability": "used"
          },
          {
            "path": "escalationReason",
            "type": "string",
            "description": "Why the ticket was escalated",
            "example": "SLA threshold reached - escalated to level 2",
            "availability": "used",
            "notes": "Generated as `SLA threshold reached - escalated to level {level}`."
          },
          {
            "path": "priority",
            "type": "string",
            "description": "Priority level of the escalated ticket",
            "example": "High",
            "availability": "used",
            "notes": "From joined priorities.priority_name; falls back to 'Not set'."
          },
          {
            "path": "clientName",
            "type": "string",
            "description": "Name of the client company the ticket belongs to",
            "example": "Acme Corporation",
            "availability": "used",
            "notes": "From joined clients.client_name; falls back to 'Unknown'."
          },
          {
            "path": "assigneeName",
            "type": "string",
            "description": "Name of the technician currently assigned to the ticket",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Built via CONCAT of the assigned user's first/last name; falls back to 'Unassigned'."
          },
          {
            "path": "ticketUrl",
            "type": "string",
            "description": "Relative link to open the escalated ticket; View Ticket button/link renders only when present",
            "example": "/msp/tickets/sample-ticket-id",
            "availability": "used",
            "notes": "Gated by {{#if ticketUrl}} in HTML and text. Assembled as `/msp/tickets/{ticketId}`."
          }
        ]
      }
    ]
  },
  {
    "category": "surveys",
    "templates": [
      {
        "templateName": "SURVEY_TICKET_CLOSED",
        "variables": [
          {
            "path": "ticket_number",
            "type": "string",
            "description": "The human-readable ticket number (or ticket ID fallback) for the closed ticket the survey is about.",
            "example": "TCK-1234",
            "availability": "used",
            "notes": "Appears in subject, header summary, and footer. Falls back to ticket_id when ticket_number is null (surveyService line 246)."
          },
          {
            "path": "contact_name",
            "type": "string",
            "description": "Full name of the client contact receiving the survey invitation.",
            "example": "Jane Smith",
            "availability": "used",
            "notes": "Used in the greeting/salutation line. From contact.full_name, defaulting to empty string."
          },
          {
            "path": "ticket_subject",
            "type": "string",
            "description": "The title/subject of the closed ticket.",
            "example": "Printer not working on 3rd floor",
            "availability": "used",
            "notes": "Shown in the header summary line next to the ticket number. From ticket.title, defaulting to empty string."
          },
          {
            "path": "technician_name",
            "type": "string",
            "description": "Name of the technician who worked the ticket, shown so the customer knows who they are rating.",
            "example": "John Doe",
            "availability": "used",
            "notes": "Used in the 'Technician:' line for all languages EXCEPT French. Assembled from the ticket's technician first/last name via formatFullName; may be empty string. French uses the misspelled {{technicien_name}} instead (see separate entry)."
          },
          {
            "path": "technicien_name",
            "type": "string",
            "description": "Misspelled French-language variant of the technician name variable, referenced only in the French translation's technician line.",
            "example": "John Doe",
            "availability": "used",
            "notes": "BUG: The French (fr) translation renders 'Technicien : {{technicien_name}}' (line 39), but the call site only supplies technician_name, never technicien_name. This variable is referenced by the template markup but has no matching key in the assembled templateData, so the French technician name always renders empty. Appears to be a template typo, not an intentional variable."
          },
          {
            "path": "prompt_text",
            "type": "string",
            "description": "The configurable survey question prompting the customer to rate their experience.",
            "example": "How would you rate your support experience?",
            "availability": "used",
            "notes": "Sourced from the survey template configuration (template.prompt_text). Rendered as the rating intro."
          },
          {
            "path": "thank_you_text",
            "type": "string",
            "description": "Configurable closing thank-you message shown after the rating options.",
            "example": "Thank you for helping us improve!",
            "availability": "used",
            "notes": "Sourced from the survey template configuration (template.thank_you_text)."
          },
          {
            "path": "rating_buttons_html",
            "type": "string",
            "description": "Pre-rendered HTML block of inline rating buttons (stars, numbers, or emojis) the customer clicks to submit a score directly from the email.",
            "example": "<a href=\"https://app.example.com/surveys/respond/sample-token?rating=1\">1 ★</a> ...",
            "availability": "used",
            "notes": "CORRECTION: inserted with a DOUBLE-stache {{rating_buttons_html}} in the source (surveyTicketClosed.cjs line 130), NOT a triple-stache as the original inventory claimed. Raw HTML block built by buildRatingButtonsHtml from rating links, type, and scale; inserted into the HTML body only."
          },
          {
            "path": "survey_url",
            "type": "url",
            "description": "Secure fallback link to the full web survey page, used if the inline buttons don't load.",
            "example": "https://app.example.com/surveys/respond/sample-token",
            "availability": "used",
            "notes": "Used as both the href and visible link text in the HTML fallback block (double-stache, line 135). Built by buildSurveyUrl from the plain survey token."
          },
          {
            "path": "rating_links_text",
            "type": "string",
            "description": "Plain-text list of rating options as 'display: url' pairs, used in the text-only version of the email and as an HTML fallback line.",
            "example": "1 ★: https://app.example.com/surveys/respond/sample-token?rating=1\n2 ★★: https://app.example.com/surveys/respond/sample-token?rating=2",
            "availability": "used",
            "notes": "CORRECTION: buildRatingLinksText (lines 560-569) produces one '<display>: <url>' line per rating, joined by newlines - NOT a pipe-separated label list as the original example implied. Rendered in both HTML (white-space:pre-line) and text bodies."
          },
          {
            "path": "tenant_name",
            "type": "string",
            "description": "Display name of the MSP/tenant sending the survey, shown in the email footer.",
            "example": "Acme IT Support",
            "availability": "used",
            "notes": "Resolved from tenant.client_name or tenant.name, defaulting to 'Your Team'."
          },
          {
            "path": "ticket_closed_at",
            "type": "date-string",
            "description": "Timestamp when the ticket was closed, shown in the email footer.",
            "example": "2026-05-12T19:09:00.000Z",
            "availability": "used",
            "notes": "ISO string via toIsoString; empty string when the ticket has no closed_at value."
          },
          {
            "path": "rating_scale",
            "type": "number",
            "description": "The maximum rating value on the survey scale (e.g. 5 for a 1-5 scale).",
            "example": "5",
            "availability": "available-unused",
            "notes": "Assembled into templateData from template.rating_scale (typed number in TemplateRow) but not referenced in the shipped template markup - only used internally to build the button/link HTML."
          },
          {
            "path": "rating_type",
            "type": "string",
            "description": "The style of rating widget: 'stars', 'emojis', or numeric.",
            "example": "stars",
            "availability": "available-unused",
            "notes": "From template.rating_type; used internally to build rating HTML/text but not referenced directly in the template."
          },
          {
            "path": "rating_labels",
            "type": "object",
            "description": "Optional per-score text labels keyed by rating number (e.g. {\"1\":\"Poor\", ... \"5\":\"Excellent\"}).",
            "example": "{\"1\":\"Poor\",\"2\":\"Fair\",\"3\":\"Good\",\"4\":\"Great\",\"5\":\"Excellent\"}",
            "availability": "available-unused",
            "notes": "CORRECTION: normaliseLabels (lines 571-589) returns a Record<string,string> OBJECT keyed by rating number, not an array as the original inventory stated. Consumed when building buttons/links but not referenced directly in the template."
          },
          {
            "path": "comment_prompt",
            "type": "string",
            "description": "Optional prompt inviting the customer to leave free-text feedback.",
            "example": "Share additional feedback (optional).",
            "availability": "available-unused",
            "notes": "From template.comment_prompt; assembled at send time but not referenced in the shipped email template."
          },
          {
            "path": "company_name",
            "type": "string",
            "description": "Name of the client company associated with the ticket.",
            "example": "Acme Corporation",
            "availability": "available-unused",
            "notes": "From ticket.client_name (defaulting to empty string); assembled but not referenced in the shipped template."
          },
          {
            "path": "expires_at",
            "type": "date-string",
            "description": "Timestamp when the survey invitation link expires (send time + 7 days by default).",
            "example": "2026-05-19T19:09:00.000Z",
            "availability": "available-unused",
            "notes": "ISO string from expiresAt (addHours(now, DEFAULT_TOKEN_TTL_HOURS)); assembled but not referenced in the shipped template."
          }
        ]
      }
    ]
  },
  {
    "category": "tickets",
    "templates": [
      {
        "templateName": "ticket-agent-assigned-client",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line; shown in the subject, header, and used throughout.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line summary combining ticket number, priority, and status, shown under the header and in the text body.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number shown on the 'Ticket #' badge (mapped from ticket_number).",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Name of the client/company the ticket belongs to, shown in the intro sentence.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the agent now assigned to the ticket; central to this notification.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email address of the assigned agent (or 'Not assigned'/'Not provided'), shown under the agent name.",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email in parentheses, used in the plain-text body.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name, shown in the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge background (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined for display.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the contact who requested the ticket.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Client-portal deep link to the ticket (the 'View Ticket' button).",
            "example": "https://portal.example.com/client-portal/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category name; present in the reduced context but the template renders categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-assigned",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name; appears in the subject and the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary shown under the header and in text.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.assignedBy",
            "type": "string",
            "description": "Full name of the user who performed the assignment (or 'System').",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email of the assigned agent (or 'Not assigned'/'Not provided').",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email in parentheses, for plain text.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name, email, and phone joined for the plain-text body.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address of the ticket location.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body (HTML-rendered via {{{ }}} in en/pt; plain {{ }} in fr/es/de/nl/it); falls back to 'No description provided.'.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "used"
          },
          {
            "path": "ticket.summary",
            "type": "string",
            "description": "pl-only description-box variable: the Polish translation's descriptionVar renders {{ticket.summary}} instead of ticket.description.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled in sendTicketAssignedNotifications, so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "MSP deep link to the ticket (the 'View Ticket' button).",
            "example": "https://app.example.com/msp/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but not referenced in this template.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but not referenced.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category name; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory name; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-auto-close-warning",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "Short meta line under the header; for this event it is just the ticket number.",
            "example": "Ticket #TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number shown on the 'Ticket #' badge (mapped from ticketNumber).",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.scheduledCloseDate",
            "type": "string",
            "description": "Formatted date the ticket will auto-close if the customer does not reply (toLocaleDateString('en-US', long month).",
            "example": "March 31, 2026",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Client-portal deep link to the ticket (the 'View Ticket' button).",
            "example": "https://portal.example.com/client-portal/tickets/sample-ticket-id?tenant=acme",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "ticket-closed",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary shown under the header and in text.",
            "example": "Ticket #TCK-1234 · High Priority · Closed",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.closedBy",
            "type": "string",
            "description": "Full name of the user who closed the ticket (or 'System').",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.closedAt",
            "type": "string",
            "description": "pl-only closed-timestamp variable: the Polish closedByVar renders '{{ticket.closedAt}} · {{ticket.closedBy}}'.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled in handleTicketClosed (only closedBy exists), so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current status name; used in the pl plain-text 'Closed status' line (other locales show a static 'Closed' label).",
            "example": "Closed",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name; rendered only in the pl priority row.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge; rendered only in the pl priority row.",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email of the assigned agent (or 'Not assigned'/'Not provided').",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email, for plain text.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone joined for plain text.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.resolution",
            "type": "string",
            "description": "HTML of the resolution comment shown in the 'Resolution' box (rendered via {{{ }}}).",
            "example": "<p>Replaced printer toner cartridge.</p>",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Deep link to the ticket (portal for the client, MSP for the assignee/resources).",
            "example": "https://app.example.com/msp/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body; assembled into the closed context but not referenced by this template.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.changes",
            "type": "string",
            "description": "Rendered HTML change list; assembled (from payload.changes) but not referenced by ticket-closed.",
            "example": "<ul>…</ul>",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-comment-added",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name, shown in the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email of the assigned agent (or 'Not assigned').",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email, for plain text.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact (also used in the pl layout).",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone joined for plain text.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Deep link to the ticket (portal for external, MSP internal for agents/watchers).",
            "example": "https://app.example.com/msp/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "comment.author",
            "type": "string",
            "description": "Display of who wrote the comment (from payload.comment.author; often an email).",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "comment.authorName",
            "type": "string",
            "description": "pl-only comment-author variable: the Polish translation renders {{comment.authorName}} instead of comment.author.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT provided by commentContext (which exposes comment.author), so it renders empty for Polish recipients."
          },
          {
            "path": "comment.body",
            "type": "string",
            "description": "pl-only comment-body variable: the Polish translation renders {{comment.body}} instead of comment.content.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT provided by commentContext (which exposes comment.content/html/text/plainText), so it renders empty for Polish recipients."
          },
          {
            "path": "comment.content",
            "type": "string",
            "description": "Rendered HTML of the comment body with inline images rewritten to CID references (rendered via {{{ }}}).",
            "example": "<p>Toner cartridge has been ordered, ETA tomorrow.</p>",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body; assembled into the comment context but not referenced by this template.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          },
          {
            "path": "comment.html",
            "type": "string",
            "description": "Same as comment.content (rewritten HTML); duplicate field on the comment context, unused.",
            "example": "<p>Toner cartridge has been ordered.</p>",
            "availability": "available-unused"
          },
          {
            "path": "comment.text",
            "type": "string",
            "description": "Plain-text extraction of the comment body; assembled but not referenced.",
            "example": "Toner cartridge has been ordered, ETA tomorrow.",
            "availability": "available-unused"
          },
          {
            "path": "comment.plainText",
            "type": "string",
            "description": "Duplicate plain-text of the comment body; assembled but unused.",
            "example": "Toner cartridge has been ordered, ETA tomorrow.",
            "availability": "available-unused"
          },
          {
            "path": "comment.rawContent",
            "type": "string",
            "description": "Original unprocessed comment content (BlockNote/raw) from the payload; assembled but unused.",
            "example": "[{\"type\":\"paragraph\"}]",
            "availability": "available-unused"
          },
          {
            "path": "comment.id",
            "type": "string",
            "description": "Comment identifier from the payload; assembled onto the context via spread but unused in the template.",
            "example": "cmt-98765",
            "availability": "available-unused"
          },
          {
            "path": "comment.isInternal",
            "type": "boolean",
            "description": "Whether the comment is internal-only; from the payload, used in JS gating (not the template).",
            "example": "false",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-created",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line; appears in the subject and header.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name; appears in the subject and the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary.",
            "example": "Ticket #TCK-1234 · High Priority · New",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro and text header.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "New",
            "availability": "used"
          },
          {
            "path": "ticket.createdAt",
            "type": "string",
            "description": "Formatted creation date/time of the ticket (Intl date-time with short timezone).",
            "example": "May 12, 2026, 3:04 PM EDT",
            "availability": "used"
          },
          {
            "path": "ticket.createdBy",
            "type": "string",
            "description": "Full name of who created the ticket (or 'System').",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email of the assigned agent (or 'Not assigned'/'Not provided').",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email, for plain text.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone joined for plain text.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body (HTML-rendered via {{{ }}}); falls back to 'No description provided.'.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "used"
          },
          {
            "path": "ticket.summary",
            "type": "string",
            "description": "pl-only description-box variable: the Polish translation's descriptionVar renders {{ticket.summary}} instead of ticket.description.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled in handleTicketCreated, so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "MSP deep link to the ticket (the 'View Ticket' button).",
            "example": "https://app.example.com/msp/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.createdDetails",
            "type": "string",
            "description": "Combined '<createdAt> · <createdBy>' string; assembled but the template composes the parts itself.",
            "example": "May 12, 2026, 3:04 PM EDT · John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.descriptionText",
            "type": "string",
            "description": "Plain-text version of the description; assembled but not referenced.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.descriptionHtml",
            "type": "string",
            "description": "HTML version of the description; assembled separately but the template uses ticket.description.",
            "example": "<p>Toner is jammed…</p>",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-created-client",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary shown under the header and in text.",
            "example": "Ticket #TCK-1234 · High Priority · New",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name, shown in the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "New",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent (name only; email intentionally omitted for clients).",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body shown in the description box (rendered via {{ }}).",
            "example": "Toner is jammed and red error light is on.",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Client-portal deep link to the ticket (the 'View Ticket' button).",
            "example": "https://portal.example.com/client-portal/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.createdAt",
            "type": "string",
            "description": "Formatted creation date/time; assembled but not shown to clients.",
            "example": "May 12, 2026, 3:04 PM EDT",
            "availability": "available-unused"
          },
          {
            "path": "ticket.createdBy",
            "type": "string",
            "description": "Creator name; assembled but not shown to clients.",
            "example": "John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.createdDetails",
            "type": "string",
            "description": "Combined createdAt · createdBy; assembled but unused.",
            "example": "May 12, 2026, 3:04 PM EDT · John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Assigned agent email; assembled but intentionally hidden from clients.",
            "example": "jane.smith@example.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name+email; assembled but unused.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Requesting contact name; assembled but not referenced.",
            "example": "John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email+phone; assembled but unused.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone; assembled but unused.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue; assembled but hidden from clients.",
            "example": "Help Desk",
            "availability": "available-unused"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category/subcategory; assembled but hidden from clients.",
            "example": "Hardware / Printer",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; assembled but unused.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; assembled but unused.",
            "example": "Printer",
            "availability": "available-unused"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site/address; assembled but hidden from clients.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "available-unused"
          },
          {
            "path": "ticket.descriptionText",
            "type": "string",
            "description": "Plain-text description; assembled but unused.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.descriptionHtml",
            "type": "string",
            "description": "HTML description; assembled but the template uses ticket.description.",
            "example": "<p>Toner is jammed…</p>",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-team-assigned",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.teamName",
            "type": "string",
            "description": "Name of the team assigned to the ticket; central to this notification.",
            "example": "Network Team",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name, shown in the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.assignedBy",
            "type": "string",
            "description": "Full name of the user who assigned the team (or 'System').",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone joined for plain text.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body (HTML-rendered via {{{ }}}).",
            "example": "Toner is jammed and red error light is on.",
            "availability": "used"
          },
          {
            "path": "ticket.summary",
            "type": "string",
            "description": "pl-only description-box variable: the Polish translation's descriptionVar renders {{ticket.summary}} instead of ticket.description.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled in sendTicketAssignedNotifications, so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Client-portal deep link to the ticket (the 'View Ticket' button).",
            "example": "https://portal.example.com/client-portal/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Assigned individual agent name; present in context but not shown in the team-assigned template.",
            "example": "Jane Smith",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Assigned agent email; present but unused.",
            "example": "jane.smith@example.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name+email; present but unused.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-updated",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line; appears in subject and header.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name; appears in the subject and the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.updatedBy",
            "type": "string",
            "description": "Name of who made the update (comma-joined list of updaters on the accumulated path; 'System' if unknown).",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.updatedAt",
            "type": "string",
            "description": "pl-only 'Updated By' timestamp variable: the Polish translation renders '{{ticket.updatedAt}} · {{ticket.updatedBy}}'.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled in handleTicketUpdated/handleAccumulatedTicketUpdates, so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent.",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Email of the assigned agent (or 'Not assigned'/'Not provided').",
            "example": "jane.smith@example.com",
            "availability": "used"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name with email, for plain text.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "used"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Name of the requesting contact.",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email and phone joined for the HTML contact block.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone joined for plain text.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "used"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue the ticket lives on.",
            "example": "Help Desk",
            "availability": "used"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category / subcategory combined.",
            "example": "Hardware / Printer",
            "availability": "used"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site name and address.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "used"
          },
          {
            "path": "ticket.changes",
            "type": "string",
            "description": "Rendered HTML list of field changes (old→new, grouped by updater/timestamp) shown in the 'Changes Made' box (rendered via {{{ }}}).",
            "example": "<ul><li>Priority: Medium → High</li></ul>",
            "availability": "used"
          },
          {
            "path": "ticket.summary",
            "type": "string",
            "description": "pl-only changes-box variable: the Polish translation's changesVar renders {{ticket.summary}} instead of {{{ticket.changes}}}.",
            "example": "",
            "availability": "used",
            "notes": "Referenced ONLY in the pl translation; NOT assembled, so it renders empty for Polish recipients."
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "MSP deep link to the ticket (the 'View Ticket' button).",
            "example": "https://app.example.com/msp/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.updateCount",
            "type": "number",
            "description": "Number of accumulated updates in this batch (accumulated path only); assembled but not referenced by the template.",
            "example": "2",
            "availability": "available-unused"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body; assembled into the updated context but not referenced.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email in isolation; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone in isolation; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; template uses categoryDetails instead.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; template uses categoryDetails instead.",
            "example": "Printer",
            "availability": "available-unused"
          }
        ]
      },
      {
        "templateName": "ticket-updated-client",
        "variables": [
          {
            "path": "ticket.title",
            "type": "string",
            "description": "The ticket's subject/title line.",
            "example": "Printer not working on 3rd floor",
            "availability": "used"
          },
          {
            "path": "ticket.metaLine",
            "type": "string",
            "description": "One-line ticket#/priority/status summary shown under the header and in text.",
            "example": "Ticket #TCK-1234 · High Priority · In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.id",
            "type": "string",
            "description": "Human-readable ticket number on the 'Ticket #' badge.",
            "example": "TCK-1234",
            "availability": "used"
          },
          {
            "path": "ticket.clientName",
            "type": "string",
            "description": "Client/company the ticket belongs to; shown in the intro.",
            "example": "Acme Corporation",
            "availability": "used"
          },
          {
            "path": "ticket.priority",
            "type": "string",
            "description": "Priority level name, shown in the priority badge.",
            "example": "High",
            "availability": "used"
          },
          {
            "path": "ticket.priorityColor",
            "type": "string",
            "description": "Hex color for the priority badge (defaults to #8A4DEA).",
            "example": "#dc2626",
            "availability": "used"
          },
          {
            "path": "ticket.status",
            "type": "string",
            "description": "Current workflow status name.",
            "example": "In Progress",
            "availability": "used"
          },
          {
            "path": "ticket.assignedToName",
            "type": "string",
            "description": "Full name of the assigned agent (name only; email hidden from clients).",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "ticket.changes",
            "type": "string",
            "description": "Rendered HTML list of field changes shown in the 'What Changed' box (rendered via {{{ }}}).",
            "example": "<ul><li>Status: New → In Progress</li></ul>",
            "availability": "used"
          },
          {
            "path": "ticket.url",
            "type": "string",
            "description": "Client-portal deep link to the ticket (the 'View Ticket' button).",
            "example": "https://portal.example.com/client-portal/tickets/sample-ticket-id",
            "availability": "used"
          },
          {
            "path": "ticket.updatedBy",
            "type": "string",
            "description": "Name of who updated; assembled but not shown to clients.",
            "example": "John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.updateCount",
            "type": "number",
            "description": "Number of accumulated updates (accumulated path only); assembled but unused.",
            "example": "2",
            "availability": "available-unused"
          },
          {
            "path": "ticket.description",
            "type": "string",
            "description": "Ticket description body; assembled but not referenced.",
            "example": "Toner is jammed and red error light is on.",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedToEmail",
            "type": "string",
            "description": "Assigned agent email; assembled but hidden from clients.",
            "example": "jane.smith@example.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.assignedDetails",
            "type": "string",
            "description": "Assigned agent name+email; assembled but unused.",
            "example": "Jane Smith (jane.smith@example.com)",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterName",
            "type": "string",
            "description": "Requesting contact name; assembled but unused.",
            "example": "John Doe",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterEmail",
            "type": "string",
            "description": "Requester email; assembled but unused.",
            "example": "john.doe@acme.com",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterPhone",
            "type": "string",
            "description": "Requester phone; assembled but unused.",
            "example": "+1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterContact",
            "type": "string",
            "description": "Requester email+phone; assembled but unused.",
            "example": "john.doe@acme.com · +1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.requesterDetails",
            "type": "string",
            "description": "Requester name/email/phone; assembled but unused.",
            "example": "John Doe · john.doe@acme.com · +1 (555) 010-1234",
            "availability": "available-unused"
          },
          {
            "path": "ticket.board",
            "type": "string",
            "description": "Board/queue; assembled but hidden from clients.",
            "example": "Help Desk",
            "availability": "available-unused"
          },
          {
            "path": "ticket.categoryDetails",
            "type": "string",
            "description": "Category/subcategory; assembled but hidden from clients.",
            "example": "Hardware / Printer",
            "availability": "available-unused"
          },
          {
            "path": "ticket.category",
            "type": "string",
            "description": "Top-level category; assembled but unused.",
            "example": "Hardware",
            "availability": "available-unused"
          },
          {
            "path": "ticket.subcategory",
            "type": "string",
            "description": "Subcategory; assembled but unused.",
            "example": "Printer",
            "availability": "available-unused"
          },
          {
            "path": "ticket.locationSummary",
            "type": "string",
            "description": "Client site/address; assembled but hidden from clients.",
            "example": "Acme HQ • 100 Main St, Springfield, IL 62701 US",
            "availability": "available-unused"
          }
        ]
      }
    ]
  },
  {
    "category": "time",
    "templates": [
      {
        "templateName": "time-entry-approved",
        "variables": [
          {
            "path": "timeEntry.date",
            "type": "string",
            "description": "The date the work was logged for on the approved time entry",
            "example": "May 12, 2026",
            "availability": "used"
          },
          {
            "path": "timeEntry.duration",
            "type": "string",
            "description": "How much time was recorded on the entry, as a human-readable duration",
            "example": "2h 30m",
            "availability": "used"
          },
          {
            "path": "timeEntry.project",
            "type": "string",
            "description": "Name of the project (or work item) the time was booked against",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "timeEntry.task",
            "type": "string",
            "description": "Name of the specific task the time was logged under",
            "example": "Firewall migration",
            "availability": "used"
          },
          {
            "path": "timeEntry.approvedBy",
            "type": "string",
            "description": "Name of the manager/approver who approved the time entry",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "timeEntry.url",
            "type": "url",
            "description": "Deep link to view the approved time entry in the app",
            "example": "https://app.example.com/msp/time-management/entries/sample-entry-id",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "time-entry-rejected",
        "variables": [
          {
            "path": "timeEntry.date",
            "type": "string",
            "description": "The date the work was logged for on the rejected time entry",
            "example": "May 12, 2026",
            "availability": "used"
          },
          {
            "path": "timeEntry.duration",
            "type": "string",
            "description": "How much time was recorded on the entry, as a human-readable duration",
            "example": "2h 30m",
            "availability": "used"
          },
          {
            "path": "timeEntry.project",
            "type": "string",
            "description": "Name of the project (or work item) the time was booked against",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "timeEntry.task",
            "type": "string",
            "description": "Name of the specific task the time was logged under",
            "example": "Firewall migration",
            "availability": "used"
          },
          {
            "path": "timeEntry.rejectedBy",
            "type": "string",
            "description": "Name of the manager/approver who rejected the time entry",
            "example": "Jane Smith",
            "availability": "used"
          },
          {
            "path": "timeEntry.rejectionReason",
            "type": "string",
            "description": "The reason the approver gave for rejecting the time entry (rendered under the 'Reason' label)",
            "example": "Duration exceeds the task estimate — please split into two entries",
            "availability": "used"
          },
          {
            "path": "timeEntry.url",
            "type": "url",
            "description": "Deep link to view/edit the rejected time entry in the app",
            "example": "https://app.example.com/msp/time-management/entries/sample-entry-id",
            "availability": "used"
          }
        ]
      },
      {
        "templateName": "time-entry-submitted",
        "variables": [
          {
            "path": "timeEntry.submittedBy",
            "type": "string",
            "description": "Name of the technician/user who submitted the time entry for review",
            "example": "John Doe",
            "availability": "used"
          },
          {
            "path": "timeEntry.date",
            "type": "string",
            "description": "The date the work was logged for on the submitted time entry",
            "example": "May 12, 2026",
            "availability": "used"
          },
          {
            "path": "timeEntry.duration",
            "type": "string",
            "description": "How much time was recorded on the entry, as a human-readable duration",
            "example": "2h 30m",
            "availability": "used"
          },
          {
            "path": "timeEntry.project",
            "type": "string",
            "description": "Name of the project (or work item) the time was booked against",
            "example": "Q2 Rollout",
            "availability": "used"
          },
          {
            "path": "timeEntry.task",
            "type": "string",
            "description": "Name of the specific task the time was logged under",
            "example": "Firewall migration",
            "availability": "used"
          },
          {
            "path": "timeEntry.url",
            "type": "url",
            "description": "Deep link for the approver to review the submitted time entry in the app",
            "example": "https://app.example.com/msp/time-management/entries/sample-entry-id",
            "availability": "used"
          }
        ]
      }
    ]
  }
];

export const sharedBlockSeed: SharedVariableBlockSeed[] = [
  {
    "name": "branding",
    "usedByCategories": [
      "auth",
      "billing",
      "invoices",
      "projects",
      "tickets",
      "time",
      "surveys",
      "opportunities"
    ],
    "notes": "Footer / layout identity block injected by the shared _shared/emailLayout.cjs wrapper and by every auth template. The wrapper's default footer is '(c) {{currentYear}} {{companyName}}', but MOST non-auth templates override footerText with their own copy (e.g. projects and billing ship a custom 'Powered by Alga PSA' footer), so currentYear/companyName are frequently present in sample data yet render nowhere. Canonical names are currentYear + companyName; every other spelling below is a variant of companyName.",
    "variables": [
      {
        "path": "currentYear",
        "type": "number",
        "description": "The current calendar year shown in the copyright footer.",
        "example": "2026",
        "availability": "used",
        "notes": "Always new Date().getFullYear() at send time. Rendered only by the layout default footer; unused wherever a template overrides footerText."
      },
      {
        "path": "companyName",
        "type": "string",
        "description": "Name shown as the sending organization in the footer / header.",
        "example": "Wolf River IT",
        "availability": "used",
        "notes": "VARIANTS for the same slot: tenantClientName (auth email-verification, from tenants.client_name), clientName (auth password-reset footer, from the passed org), tenant_name (surveys, tenant.client_name||tenant.name, default 'Your Team'), company.name (invoices/billing MSP sender). These are NOT interchangeable across categories - see client block for the client-vs-MSP-company collision."
      },
      {
        "path": "platformName",
        "type": "string",
        "description": "Portal/product name shown in subject, header banner and footer.",
        "example": "Client Portal",
        "availability": "used",
        "notes": "auth-only (no-account-found, tenant-recovery). process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Client Portal'. Substituted via a custom regex replaceVariables(), not the Handlebars/DatabaseTemplateProcessor path."
      }
    ]
  },
  {
    "name": "contact",
    "usedByCategories": [
      "appointments",
      "auth"
    ],
    "notes": "Support / help contact pair. Canonical names contactEmail + contactPhone (appointments). auth carries the same concept under different names and defaults them to the literal 'Not provided'. In several appointment templates contactEmail/contactPhone are assembled but not rendered (staff-facing new-appointment-request), so availability is call-site specific.",
    "variables": [
      {
        "path": "contactEmail",
        "type": "string",
        "description": "Support email address the recipient can reach out to (often also set as Reply-To).",
        "example": "support@acme-it.com",
        "availability": "used",
        "notes": "VARIANTS: supportEmail (auth password-reset, also replyTo), clientLocationEmail (auth portal-invitation, defaults 'Not provided', also replyTo). Assembled-but-unused in new-appointment-request (staff template)."
      },
      {
        "path": "contactPhone",
        "type": "string",
        "description": "Support phone number, shown only when provided.",
        "example": "+1 (555) 010-1234",
        "availability": "used",
        "notes": "Optional; every appointment template guards it with {{#if contactPhone}}. VARIANT: clientLocationPhone (auth portal-invitation, defaults 'Not provided')."
      }
    ]
  },
  {
    "name": "client",
    "usedByCategories": [
      "billing",
      "invoices",
      "tickets",
      "appointments",
      "surveys",
      "auth"
    ],
    "notes": "The end-customer company the message concerns. This is the most naming-fragmented concept in the whole set: it appears as company.name, client.name, clientName, ticket.clientName, company_name and companyName across categories, AND collides head-on with the MSP-sender company (invoices uses company.name for the MSP's OWN name while billing uses company.name for the CLIENT). billing/credit-expiring ships an ACTIVE bug: the template reads {{company.name}} but the subscriber only supplies client.name, so the client name renders empty in production.",
    "variables": [
      {
        "path": "client.name",
        "type": "string",
        "description": "Name of the end-customer company the email is about.",
        "example": "Acme Corporation",
        "availability": "used",
        "notes": "VARIANTS: clientName (tickets flatten to ticket.clientName; appointments/auth use bare clientName), company.name (billing credit-expiring template path - MISMATCHED, see notes; also invoice-email/invoice-generated where company.name is instead the MSP sender), company_name (surveys, ticket.client_name), invoice.clientName (invoices generated/overdue/received). Registry must distinguish 'client company' from 'MSP sending company' - same path shape, opposite meaning."
      },
      {
        "path": "client.id",
        "type": "string",
        "description": "Internal identifier of the client company.",
        "example": "client-001",
        "availability": "available-unused",
        "notes": "Only billing assembles it (clients.client_id, feeds credits.url); not rendered directly."
      }
    ]
  },
  {
    "name": "recipient",
    "usedByCategories": [
      "auth",
      "appointments",
      "projects",
      "sla",
      "surveys",
      "invoices"
    ],
    "notes": "The individual person the email greets. Canonical recipientName + recipientEmail. Enormously variant-heavy: the greeting name is called recipientName (sla), requesterName (appointments), contactName (auth portal-invitation), userName (auth password-reset), contact_name (surveys), technicianName (appointment-assigned-technician, where the technician IS the recipient), recipient.name (invoices). Note recipientName is REFERENCED but never supplied in both project-task-assigned templates, so the greeting renders nameless.",
    "variables": [
      {
        "path": "recipientName",
        "type": "string",
        "description": "Display name of the person receiving the email, used in the greeting.",
        "example": "John Doe",
        "availability": "used",
        "notes": "VARIANTS: requesterName (appointments, optional - greeting is generic if absent), contactName (auth), userName (auth password-reset), contact_name (surveys, default ''), recipient.name (invoices - billing contact full_name or client name), technicianName (appointment-assigned-technician greeting). NOT populated in project-task-assigned-primary/-additional (guarded by {{#if recipientName}}, renders empty). sla assembles it per-recipient only on the email channel, defaulting to 'there'/'Team Member'."
      },
      {
        "path": "recipientEmail",
        "type": "string",
        "description": "Email address of the recipient (typically the send-to address).",
        "example": "jane.smith@client.com",
        "availability": "available-unused",
        "notes": "VARIANTS: requesterEmail (appointments - used as send-to, not rendered in received/approved/declined; but IS rendered in the staff new-appointment-request), email (auth - rendered in password-reset, unused in email-verification), recipient.email (invoices, assembled-unused), technicianEmail (appointment-assigned-technician, required as send-to but unrendered). Availability flips per template - do not assume block-global."
      }
    ]
  },
  {
    "name": "assignee",
    "usedByCategories": [
      "tickets",
      "appointments",
      "sla"
    ],
    "notes": "The agent/technician/team responsible for the work item. Tickets nest under ticket.assignedTo*, appointments flatten to technician*, sla uses assigneeName. Tickets additionally pre-compose display strings (assignedDetails) that duplicate name+email.",
    "variables": [
      {
        "path": "assignee.name",
        "type": "string",
        "description": "Full name of the assigned agent/technician.",
        "example": "Jane Smith",
        "availability": "used",
        "notes": "VARIANTS: ticket.assignedToName (tickets), technicianName (appointments), assigneeName (sla-escalation, CONCAT first/last, default 'Unassigned'). Ticket client-facing templates render name only (email hidden)."
      },
      {
        "path": "assignee.email",
        "type": "string",
        "description": "Email address of the assigned agent/technician.",
        "example": "jane.smith@acme-it.com",
        "availability": "used",
        "notes": "VARIANTS: ticket.assignedToEmail (default 'Not assigned'/'Not provided'), technicianEmail (appointments). Assembled-but-unused / intentionally hidden in all client-facing ticket templates."
      },
      {
        "path": "assignee.phone",
        "type": "string",
        "description": "Phone number of the assigned technician, shown only when present.",
        "example": "+1 (555) 010-5678",
        "availability": "used",
        "notes": "Appointments only (technicianPhone, {{#if}} guarded). No ticket equivalent."
      },
      {
        "path": "assignee.details",
        "type": "string",
        "description": "Pre-composed 'Name (email)' string for plain-text bodies.",
        "example": "Jane Smith (jane.smith@example.com)",
        "availability": "used",
        "notes": "Tickets only (ticket.assignedDetails). A derived/denormalized field - registry should mark it computed-from name+email."
      },
      {
        "path": "assignee.teamName",
        "type": "string",
        "description": "Name of the team assigned (when a team rather than an individual is assigned).",
        "example": "Network Team",
        "availability": "used",
        "notes": "tickets ticket.teamName (ticket-team-assigned) only. Present only when the assignment event carries changes.assigned_team_id."
      }
    ]
  },
  {
    "name": "ticket",
    "usedByCategories": [
      "tickets",
      "sla",
      "surveys"
    ],
    "notes": "Rich work-item block. Tickets use a fully NESTED ticket.* namespace (10 templates share one baseTicketContext with only a subset rendered per template). sla FLATTENS the same concept to top-level camelCase (ticketNumber/ticketTitle/ticketUrl/priorityName). surveys FLATTENS to snake_case (ticket_number/ticket_subject/ticket_closed_at). Three incompatible conventions for one entity - the single biggest registry challenge. Also note ticket.id is misnamed: it holds the human-readable ticket_number, not a UUID. Several ticket.* paths (summary, closedAt, updatedAt, comment.authorName, comment.body) exist ONLY in Polish translations and are never assembled - they render empty for pl recipients.",
    "variables": [
      {
        "path": "ticket.id",
        "type": "string",
        "description": "Human-readable ticket number shown on the 'Ticket #' badge.",
        "example": "TCK-1234",
        "availability": "used",
        "notes": "MISNOMER: mapped from ticket_number/ticketNumber, not a UUID. VARIANTS: ticketNumber (sla, flat), ticket_number (surveys, snake_case, falls back to ticket_id)."
      },
      {
        "path": "ticket.title",
        "type": "string",
        "description": "The ticket's subject/title line.",
        "example": "Printer not working on 3rd floor",
        "availability": "used",
        "notes": "VARIANTS: ticketTitle (sla), ticket_subject (surveys, ticket.title default '')."
      },
      {
        "path": "ticket.metaLine",
        "type": "string",
        "description": "One-line ticket#/priority/status summary under the header.",
        "example": "Ticket #TCK-1234 - High Priority - In Progress",
        "availability": "used",
        "notes": "Derived/denormalized. In ticket-auto-close-warning it collapses to just 'Ticket #<number>'. No sla/survey equivalent."
      },
      {
        "path": "ticket.clientName",
        "type": "string",
        "description": "Client/company the ticket belongs to.",
        "example": "Acme Corporation",
        "availability": "used",
        "notes": "VARIANTS: clientName (sla, flat). Overlaps the client block - same value, ticket-scoped path."
      },
      {
        "path": "ticket.priority",
        "type": "string",
        "description": "Priority level name; drives the priority badge.",
        "example": "High",
        "availability": "used",
        "notes": "VARIANT/DUPLICATE: sla ships BOTH priority and priorityName holding the same value (priorityName is assembled-unused in sla-breach/warning)."
      },
      {
        "path": "ticket.priorityColor",
        "type": "string",
        "description": "Hex color for the priority badge background.",
        "example": "#dc2626",
        "availability": "used",
        "notes": "Tickets only; default '#8A4DEA'. Raw style value injected into HTML."
      },
      {
        "path": "ticket.status",
        "type": "string",
        "description": "Current workflow status name.",
        "example": "In Progress",
        "availability": "used",
        "notes": "Tickets. sla has no status; slaType ('Response'/'Resolution') is a different concept."
      },
      {
        "path": "ticket.board",
        "type": "string",
        "description": "Board/queue the ticket lives on.",
        "example": "Help Desk",
        "availability": "used",
        "notes": "Tickets only. Hidden in client-facing variants."
      },
      {
        "path": "ticket.categoryDetails",
        "type": "string",
        "description": "Combined 'Category / subcategory' display string.",
        "example": "Hardware / Printer",
        "availability": "used",
        "notes": "Derived. Raw category and subcategory are also assembled but always available-unused (template always uses categoryDetails)."
      },
      {
        "path": "ticket.description",
        "type": "string",
        "description": "Ticket description body (raw HTML via triple-stache in en/pt; escaped in fr/es/de/nl/it).",
        "example": "Toner is jammed and red error light is on.",
        "availability": "used",
        "notes": "RAW-HTML in some locales. pl translations swap in {{ticket.summary}} (never assembled -> empty). descriptionText/descriptionHtml duplicates are assembled-unused."
      },
      {
        "path": "ticket.url",
        "type": "string",
        "description": "Deep link to the ticket ('View Ticket' button).",
        "example": "https://app.example.com/msp/tickets/sample-ticket-id",
        "availability": "used",
        "notes": "MSP vs client-portal variant chosen per recipient for the SAME path. VARIANTS: ticketUrl (sla - RELATIVE path '/msp/tickets/<id>', {{#if}} guarded), survey_url (surveys, different semantics - survey response link)."
      },
      {
        "path": "ticket.requesterContact",
        "type": "string",
        "description": "Requester email+phone joined for the HTML contact block.",
        "example": "john.doe@acme.com - +1 (555) 010-1234",
        "availability": "used",
        "notes": "Derived. requesterDetails (name+email+phone) is the plain-text twin. Raw requesterEmail/requesterPhone are assembled-unused across ticket templates."
      },
      {
        "path": "ticket.changes",
        "type": "string",
        "description": "Pre-rendered HTML list of field changes (raw via triple-stache).",
        "example": "<ul><li>Priority: Medium -> High</li></ul>",
        "availability": "used",
        "notes": "RAW-HTML. ticket-updated/-closed. pl swaps in {{ticket.summary}} (unassembled). Assembled-unused in ticket-closed."
      },
      {
        "path": "ticket.resolution",
        "type": "string",
        "description": "HTML of the resolution comment shown in the 'Resolution' box (raw).",
        "example": "<p>Replaced printer toner cartridge.</p>",
        "availability": "used",
        "notes": "RAW-HTML, ticket-closed only. May be empty if no is_resolution comment exists."
      },
      {
        "path": "ticket.closedBy",
        "type": "string",
        "description": "Full name of who closed the ticket (or 'System').",
        "example": "John Doe",
        "availability": "used",
        "notes": "ticket-closed. pl also references {{ticket.closedAt}} which is NEVER assembled -> empty."
      },
      {
        "path": "ticket.createdAt",
        "type": "date-string",
        "description": "Formatted creation date/time (Intl date-time with short tz).",
        "example": "May 12, 2026, 3:04 PM EDT",
        "availability": "used",
        "notes": "ticket-created. Pre-formatted string, not ISO. createdBy/createdDetails companions."
      },
      {
        "path": "ticket.updatedBy",
        "type": "string",
        "description": "Name(s) of who updated (comma-joined on accumulated path, 'System' if unknown).",
        "example": "John Doe",
        "availability": "used",
        "notes": "ticket-updated. pl references unassembled {{ticket.updatedAt}} -> empty. updateCount present only on accumulated-batch path (assembled-unused)."
      },
      {
        "path": "ticket.scheduledCloseDate",
        "type": "string",
        "description": "Formatted date the ticket will auto-close if the customer does not reply.",
        "example": "March 31, 2026",
        "availability": "used",
        "notes": "ticket-auto-close-warning only; its reduced context supplies ONLY id/title/metaLine/scheduledCloseDate/url."
      },
      {
        "path": "ticket.slaType",
        "type": "string",
        "description": "Which SLA clock is at risk/breached - Response or Resolution.",
        "example": "Response",
        "availability": "used",
        "notes": "sla-only (flattened). Capitalized from context.slaType."
      },
      {
        "path": "ticket.timeRemaining",
        "type": "string",
        "description": "Human-formatted time until/over SLA breach.",
        "example": "30 minutes",
        "availability": "used",
        "notes": "sla-only. TRIPLICATE: timeRemaining/remainingTime/timeOverdue all hold the same formatRemainingTime() value; each template renders one and leaves the other two assembled-unused."
      }
    ]
  },
  {
    "name": "invoice",
    "usedByCategories": [
      "invoices"
    ],
    "notes": "Nested invoice.* block shared across all 4 invoice templates (email/generated/overdue/received). Single-category but strongly recurrent. Only invoice-email has a real wired send path; the other three are seeded-but-unsent, so their variable contracts are template-inferred, not call-site-verified. Currency and date fields are expected PRE-FORMATTED (formatCurrency/formatDate upstream).",
    "variables": [
      {
        "path": "invoice.number",
        "type": "string",
        "description": "Human-readable invoice number.",
        "example": "INV-000123",
        "availability": "used",
        "notes": "From invoice.invoice_number. Used in subject + body across all four."
      },
      {
        "path": "invoice.amount",
        "type": "string",
        "description": "Total due, pre-formatted currency string.",
        "example": "$1,250.00",
        "availability": "used",
        "notes": "VARIANTS by template: invoice.amountDue (payment-overdue), invoice.amountPaid (payment-received). All pre-formatted currency strings."
      },
      {
        "path": "invoice.dueDate",
        "type": "date-string",
        "description": "Payment due date, pre-formatted.",
        "example": "August 9, 2026",
        "availability": "used",
        "notes": "Falls back to 'N/A'. Companion date fields: invoice.invoiceDate (email), invoice.paymentDate (received)."
      },
      {
        "path": "invoice.clientName",
        "type": "string",
        "description": "The client the invoice is for.",
        "example": "Acme Corporation",
        "availability": "used",
        "notes": "generated/overdue/received. Overlaps the client block. Note invoice-email instead uses recipient.name + company.name (MSP)."
      },
      {
        "path": "invoice.url",
        "type": "url",
        "description": "Link to view the invoice in the app ('View Invoice' button).",
        "example": "https://app.example.com/msp/billing/invoices/inv-001",
        "availability": "used",
        "notes": "Present in generated/overdue/received; invoice-email has NO url (it attaches the PDF instead)."
      },
      {
        "path": "invoice.daysOverdue",
        "type": "number",
        "description": "How many days past due the invoice is.",
        "example": "14",
        "availability": "used",
        "notes": "payment-overdue only."
      },
      {
        "path": "invoice.paymentMethod",
        "type": "string",
        "description": "How the payment was made.",
        "example": "Credit Card",
        "availability": "used",
        "notes": "payment-received only."
      }
    ]
  },
  {
    "name": "appointment",
    "usedByCategories": [
      "appointments"
    ],
    "notes": "Flat (non-nested) block recurring across the 5 appointment templates. Two naming pairs for the same slot depending on lifecycle stage: requestedDate/requestedTime (pending) vs appointmentDate/appointmentTime (confirmed/assigned). referenceNumber has a DUAL FORMAT problem: the public route emits 'APT-<base36>-<random>' while the portal emits an 8-char uppercased id slice, for the SAME template variable.",
    "variables": [
      {
        "path": "serviceName",
        "type": "string",
        "description": "Name of the requested/confirmed service.",
        "example": "Network Assessment",
        "availability": "used",
        "notes": "Present in all 5 templates; also drives subjects/headerTitle."
      },
      {
        "path": "appointmentDate",
        "type": "string",
        "description": "Confirmed appointment date, pre-formatted.",
        "example": "Monday, July 21, 2026",
        "availability": "used",
        "notes": "VARIANT for pending stage: requestedDate. Both are pre-formatted display strings."
      },
      {
        "path": "appointmentTime",
        "type": "string",
        "description": "Confirmed appointment time, pre-formatted.",
        "example": "2:00 PM EDT",
        "availability": "used",
        "notes": "VARIANT for pending stage: requestedTime (rendered with a parenthesized tz, e.g. '2:00 PM (EDT)'). Timezone label differs by call site."
      },
      {
        "path": "duration",
        "type": "number",
        "description": "Appointment length in minutes ('minutes' appended by template).",
        "example": "60",
        "availability": "used",
        "notes": "Consistent across all 5 templates."
      },
      {
        "path": "referenceNumber",
        "type": "string",
        "description": "Short reference code the customer can quote.",
        "example": "APT-LZ3K9-QX7A",
        "availability": "used",
        "notes": "DUAL FORMAT for one variable: public route = generateReferenceNumber() 'APT-<base36 ts>-<random>'; portal = appointment_request_id.slice(0,8).toUpperCase() e.g. 'A1B2C3D4'. declined template (management-only) always uses the id-slice form."
      },
      {
        "path": "onlineMeetingUrl",
        "type": "url",
        "description": "Microsoft Teams join link when the appointment is online.",
        "example": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123",
        "availability": "used",
        "notes": "Optional, {{#if}} guarded. Shared by approved + assigned-technician templates."
      },
      {
        "path": "calendarLink",
        "type": "url",
        "description": "ICS calendar download link.",
        "example": "https://app.algapsa.com/api/appointments/ics/abc123",
        "availability": "used",
        "notes": "Optional, {{#if}} guarded. approved + assigned-technician."
      }
    ]
  },
  {
    "name": "project",
    "usedByCategories": [
      "projects"
    ],
    "notes": "Nested project.* block shared across the project-scoped templates (created/updated/closed/assigned/milestone). A large baseContext is assembled once and each template renders only ~5 of ~14 fields, so most fields are available-unused per template. Several templates (milestone-completed) have NO send handler - contract is template-inferred. Raw-HTML in project.changes. project.startDate is a raw DB value (not pre-formatted), unlike most date fields elsewhere.",
    "variables": [
      {
        "path": "project.name",
        "type": "string",
        "description": "Name of the project.",
        "example": "Q2 Rollout",
        "availability": "used",
        "notes": "Rendered by every project template; drives subjects."
      },
      {
        "path": "project.description",
        "type": "string",
        "description": "Project description (BlockNote flattened to text).",
        "example": "Roll out new endpoint protection to all client sites.",
        "availability": "used",
        "notes": "descriptionText (duplicate) and descriptionHtml (HTML twin) are assembled-unused alongside it."
      },
      {
        "path": "project.status",
        "type": "string",
        "description": "Current status label (default 'Unknown').",
        "example": "In Progress",
        "availability": "used",
        "notes": "used in updated/closed; available-unused in created."
      },
      {
        "path": "project.url",
        "type": "url",
        "description": "Link to open the project.",
        "example": "https://app.example.com/msp/projects/sample-project-id",
        "availability": "used",
        "notes": "client-portal vs MSP variant per recipient - EXCEPT project-assigned which is always the internal /msp URL."
      },
      {
        "path": "project.changes",
        "type": "string",
        "description": "Pre-rendered HTML list of field changes (raw via triple-stache).",
        "example": "<ul>...</ul>",
        "availability": "used",
        "notes": "RAW-HTML. updated/closed only."
      },
      {
        "path": "project.startDate",
        "type": "date-string",
        "description": "Project start date.",
        "example": "2026-05-01",
        "availability": "used",
        "notes": "RAW DB value (projects.start_date), NOT pre-formatted - inconsistent with pre-formatted date fields in other blocks."
      },
      {
        "path": "project.manager",
        "type": "string",
        "description": "Project manager name (default 'Unassigned').",
        "example": "Jane Smith",
        "availability": "used",
        "notes": "used in created; available-unused in updated/closed."
      },
      {
        "path": "project.updatedBy",
        "type": "string",
        "description": "Name of who updated/closed/assigned the project.",
        "example": "John Doe",
        "availability": "used",
        "notes": "VARIANTS: closedBy (resolved name), assignedBy (default 'Someone'), createdBy (RAW user ID, NOT a display name - inconsistent resolution vs updatedBy/closedBy)."
      },
      {
        "path": "project.progress",
        "type": "number",
        "description": "Overall completion percentage (rendered with trailing %).",
        "example": "65",
        "availability": "used",
        "notes": "milestone-completed only (which has no send handler)."
      },
      {
        "path": "project.id",
        "type": "string",
        "description": "Human-readable project number (projects.project_number).",
        "example": "PRJ-0042",
        "availability": "available-unused",
        "notes": "Misnomer like ticket.id - it's a number, not a UUID. Assembled but unrendered in every project template."
      },
      {
        "path": "project.client",
        "type": "string",
        "description": "Name of the client the project belongs to (default 'No Client').",
        "example": "Acme Corporation",
        "availability": "available-unused",
        "notes": "Assembled but never rendered by any project template. Overlaps the client block."
      }
    ]
  },
  {
    "name": "task",
    "usedByCategories": [
      "projects"
    ],
    "notes": "Nested task.* block shared by the task templates (assigned-primary, assigned-additional, comment-added, updated). assigned-primary/-additional are byte-identical except task.role ('Primary Assignee' vs 'Additional Agent') and the greeting subject. task.description and recipientName are {{#if}}-referenced but NEVER supplied at send time. task-updated has no send handler. comment.* is a sub-block only used by task/ticket comment templates.",
    "variables": [
      {
        "path": "task.name",
        "type": "string",
        "description": "Name of the task.",
        "example": "Configure firewall rules",
        "availability": "used",
        "notes": "Drives subjects. Present in all task templates."
      },
      {
        "path": "task.project",
        "type": "string",
        "description": "Name of the project the task belongs to.",
        "example": "Q2 Rollout",
        "availability": "used",
        "notes": "VARIANT: task-comment-added and task-updated use nested project.name instead of task.project for the same value - inconsistent within the same category."
      },
      {
        "path": "task.dueDate",
        "type": "date-string",
        "description": "Task due date (row shown only when present).",
        "example": "2026-06-30",
        "availability": "used",
        "notes": "{{#if}} guarded. Raw project_tasks.due_date."
      },
      {
        "path": "task.assignedBy",
        "type": "string",
        "description": "Name of who assigned the task (default 'Someone').",
        "example": "John Doe",
        "availability": "used",
        "notes": "From event payload assignedByName."
      },
      {
        "path": "task.role",
        "type": "string",
        "description": "Recipient's role on the task.",
        "example": "Primary Assignee",
        "availability": "used",
        "notes": "'Primary Assignee' vs 'Additional Agent' - the only meaningful data difference between the two assignment templates."
      },
      {
        "path": "task.url",
        "type": "url",
        "description": "MSP link to open the task within the project view.",
        "example": "https://app.example.com/msp/projects/sample-project-id?phaseId=ph-1&taskId=tk-1",
        "availability": "used",
        "notes": "Always MSP (no client-portal variant for tasks)."
      },
      {
        "path": "task.status",
        "type": "string",
        "description": "Current task status label.",
        "example": "In Progress",
        "availability": "used",
        "notes": "task-updated only (no send handler)."
      },
      {
        "path": "task.progress",
        "type": "number",
        "description": "Task completion percentage (trailing %).",
        "example": "50",
        "availability": "used",
        "notes": "task-updated only."
      },
      {
        "path": "task.description",
        "type": "string",
        "description": "Task description shown in a highlighted box when present.",
        "example": "Apply the standard firewall baseline to all edge devices.",
        "availability": "available-unused",
        "notes": "{{#if task.description}} REFERENCED but NEVER supplied by the send context in both assignment templates -> always renders empty. Registry must not treat as reliably populated."
      }
    ]
  }
];
