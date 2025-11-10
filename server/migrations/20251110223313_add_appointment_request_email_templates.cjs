/**
 * Add appointment request email templates to system_email_templates
 *
 * This migration adds four email templates for the appointment request system:
 * 1. appointment-request-received - Confirmation to client/requester
 * 2. appointment-request-approved - Approval notification to client/requester
 * 3. appointment-request-declined - Decline notification to client/requester
 * 4. new-appointment-request - Notification to MSP staff for approval
 *
 * Templates are created for English initially. Additional languages can be added
 * via subsequent migrations or seed files.
 */

exports.up = async function(knex) {
  console.log('Adding appointment request email templates...');

  // Ensure Appointments category exists
  let appointmentsCategory = await knex('notification_categories')
    .where({ name: 'Appointments' })
    .first();

  if (!appointmentsCategory) {
    [appointmentsCategory] = await knex('notification_categories')
      .insert({
        name: 'Appointments',
        description: 'Appointment request and scheduling notifications',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    console.log('✓ Created Appointments notification category');
  }

  // Create notification subtypes for appointment requests
  const subtypeNames = {
    'appointment-request-received': 'Confirmation that appointment request was received',
    'appointment-request-approved': 'Notification that appointment request was approved',
    'appointment-request-declined': 'Notification that appointment request was declined',
    'new-appointment-request': 'New appointment request notification for MSP staff'
  };

  const subtypeIds = {};

  for (const [name, description] of Object.entries(subtypeNames)) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: appointmentsCategory.id,
          name,
          description,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`✓ Created notification subtype: ${name}`);
    }

    subtypeIds[name] = subtype.id;
  }

  // English (en) templates
  const templates = [
    // 1. Appointment Request Received - To client/requester
    {
      name: 'appointment-request-received',
      language_code: 'en',
      subject: 'Appointment Request Received - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment Request Received</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .container {
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .content {
      padding: 32px 24px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 16px 0;
    }
    .message {
      color: #475569;
      margin: 0 0 24px 0;
      font-size: 16px;
    }
    .details-box {
      background-color: #f8fafc;
      border-left: 4px solid #8a4dea;
      padding: 20px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .details-box h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }
    .detail-row {
      display: flex;
      margin-bottom: 12px;
      font-size: 15px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      font-weight: 600;
      color: #475569;
      min-width: 120px;
    }
    .detail-value {
      color: #1e293b;
    }
    .reference-number {
      background-color: #ede9fe;
      color: #6d28d9;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
      font-size: 16px;
    }
    .info-box {
      background-color: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 16px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .info-box p {
      margin: 0;
      color: #1e40af;
      font-size: 14px;
    }
    .footer {
      padding: 24px;
      text-align: center;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 8px 0;
      color: #64748b;
      font-size: 14px;
    }
    .footer .copyright {
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Request Received</h1>
      <p>We've received your appointment request</p>
    </div>

    <div class="content">
      <p class="greeting">Hello{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Thank you for submitting your appointment request. We have received your request and our team will review it shortly.
      </p>

      <div class="reference-number">
        Reference: {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Request Details</h3>
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Date:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Time:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">{{duration}} minutes</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Preferred Technician:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>What happens next?</strong></p>
        <p>Our team will review your request and confirm availability. You will receive an email notification once your appointment has been approved or if any changes are needed. We typically respond within {{responseTime}}.</p>
      </div>

      <p class="message">
        If you have any questions or need to make changes to your request, please contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.
      </p>
    </div>

    <div class="footer">
      <p>Thank you for choosing {{tenantName}}</p>
      <p class="copyright">© {{currentYear}} {{tenantName}}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `,
      text_content: `Appointment Request Received

Hello{{#if requesterName}} {{requesterName}}{{/if}},

Thank you for submitting your appointment request. We have received your request and our team will review it shortly.

Reference Number: {{referenceNumber}}

REQUEST DETAILS:
Service: {{serviceName}}
Requested Date: {{requestedDate}}
Requested Time: {{requestedTime}}
Duration: {{duration}} minutes
{{#if preferredTechnician}}Preferred Technician: {{preferredTechnician}}{{/if}}

WHAT HAPPENS NEXT?
Our team will review your request and confirm availability. You will receive an email notification once your appointment has been approved or if any changes are needed. We typically respond within {{responseTime}}.

If you have any questions or need to make changes to your request, please contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.

Thank you for choosing {{tenantName}}

© {{currentYear}} {{tenantName}}. All rights reserved.`
    },

    // 2. Appointment Request Approved - To client/requester
    {
      name: 'appointment-request-approved',
      language_code: 'en',
      subject: 'Appointment Confirmed - {{serviceName}} on {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment Confirmed</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .container {
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .checkmark {
      width: 64px;
      height: 64px;
      background-color: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 32px;
    }
    .content {
      padding: 32px 24px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 16px 0;
    }
    .message {
      color: #475569;
      margin: 0 0 24px 0;
      font-size: 16px;
    }
    .appointment-box {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #10b981;
      padding: 24px;
      margin: 24px 0;
      border-radius: 8px;
      text-align: center;
    }
    .appointment-box h3 {
      margin: 0 0 20px 0;
      font-size: 18px;
      font-weight: 600;
      color: #065f46;
    }
    .appointment-detail {
      margin: 12px 0;
      font-size: 16px;
    }
    .appointment-detail strong {
      color: #047857;
      display: block;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .appointment-detail span {
      color: #1e293b;
      font-size: 18px;
      font-weight: 600;
    }
    .technician-box {
      background-color: #f8fafc;
      border-left: 4px solid #8a4dea;
      padding: 20px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .technician-box h4 {
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }
    .technician-info {
      color: #475569;
      font-size: 15px;
    }
    .action-button {
      display: inline-block;
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      margin: 8px 0;
    }
    .action-button:hover {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
    }
    .policy-box {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .policy-box h4 {
      margin: 0 0 8px 0;
      font-size: 15px;
      font-weight: 600;
      color: #92400e;
    }
    .policy-box p {
      margin: 0;
      color: #78350f;
      font-size: 14px;
    }
    .footer {
      padding: 24px;
      text-align: center;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 8px 0;
      color: #64748b;
      font-size: 14px;
    }
    .footer .copyright {
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="checkmark">✓</div>
      <h1>Appointment Confirmed</h1>
      <p>Your appointment has been approved</p>
    </div>

    <div class="content">
      <p class="greeting">Hello{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Great news! Your appointment request has been approved and confirmed. We look forward to serving you.
      </p>

      <div class="appointment-box">
        <h3>Your Appointment</h3>
        <div class="appointment-detail">
          <strong>Service</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Date</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Time</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Duration</strong>
          <span>{{duration}} minutes</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Assigned Technician</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>Email: {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Phone: {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Add to Calendar</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Cancellation Policy</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        If you need to reschedule or cancel this appointment, please contact us at least {{minimumNoticeHours}} hours in advance at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.
      </p>

      <p class="message">
        We'll send you a reminder before your appointment. See you soon!
      </p>
    </div>

    <div class="footer">
      <p>Thank you for choosing {{tenantName}}</p>
      <p class="copyright">© {{currentYear}} {{tenantName}}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `,
      text_content: `Appointment Confirmed

Hello{{#if requesterName}} {{requesterName}}{{/if}},

Great news! Your appointment request has been approved and confirmed. We look forward to serving you.

YOUR APPOINTMENT:
Service: {{serviceName}}
Date: {{appointmentDate}}
Time: {{appointmentTime}}
Duration: {{duration}} minutes

{{#if technicianName}}
ASSIGNED TECHNICIAN:
{{technicianName}}
{{#if technicianEmail}}Email: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Phone: {{technicianPhone}}{{/if}}
{{/if}}

{{#if calendarLink}}
Add to Calendar: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
CANCELLATION POLICY:
{{cancellationPolicy}}
{{/if}}

If you need to reschedule or cancel this appointment, please contact us at least {{minimumNoticeHours}} hours in advance at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.

We'll send you a reminder before your appointment. See you soon!

Thank you for choosing {{tenantName}}

© {{currentYear}} {{tenantName}}. All rights reserved.`
    },

    // 3. Appointment Request Declined - To client/requester
    {
      name: 'appointment-request-declined',
      language_code: 'en',
      subject: 'Appointment Request Update - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment Request Update</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .container {
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
    }
    .header {
      background: linear-gradient(135deg, #64748b 0%, #475569 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .content {
      padding: 32px 24px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 16px 0;
    }
    .message {
      color: #475569;
      margin: 0 0 24px 0;
      font-size: 16px;
    }
    .details-box {
      background-color: #f8fafc;
      border-left: 4px solid #64748b;
      padding: 20px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .details-box h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }
    .detail-row {
      margin-bottom: 12px;
      font-size: 15px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      font-weight: 600;
      color: #475569;
      display: block;
      margin-bottom: 4px;
    }
    .detail-value {
      color: #1e293b;
    }
    .reason-box {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 16px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .reason-box h4 {
      margin: 0 0 8px 0;
      font-size: 15px;
      font-weight: 600;
      color: #991b1b;
    }
    .reason-box p {
      margin: 0;
      color: #7f1d1d;
      font-size: 14px;
    }
    .action-box {
      background-color: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 20px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .action-box h4 {
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1e40af;
    }
    .action-box p {
      margin: 0 0 16px 0;
      color: #1e3a8a;
      font-size: 14px;
    }
    .action-button {
      display: inline-block;
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
    }
    .action-button:hover {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
    }
    .footer {
      padding: 24px;
      text-align: center;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 8px 0;
      color: #64748b;
      font-size: 14px;
    }
    .footer .copyright {
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Appointment Request Update</h1>
      <p>Regarding your recent appointment request</p>
    </div>

    <div class="content">
      <p class="greeting">Hello{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Thank you for your interest in scheduling an appointment with us. Unfortunately, we are unable to accommodate your request at the requested time.
      </p>

      <div class="details-box">
        <h3>Original Request</h3>
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Date:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Time:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reference:</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Reason</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>We'd Still Love to Help</h4>
        <p>We apologize for any inconvenience. We encourage you to submit a new request for an alternative date and time that works better with our availability.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Request Another Time</a>
        {{/if}}
      </div>

      <p class="message">
        If you have any questions or would like assistance finding an available time slot, please don't hesitate to contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}. Our team is here to help you find a time that works.
      </p>
    </div>

    <div class="footer">
      <p>Thank you for choosing {{tenantName}}</p>
      <p class="copyright">© {{currentYear}} {{tenantName}}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `,
      text_content: `Appointment Request Update

Hello{{#if requesterName}} {{requesterName}}{{/if}},

Thank you for your interest in scheduling an appointment with us. Unfortunately, we are unable to accommodate your request at the requested time.

ORIGINAL REQUEST:
Service: {{serviceName}}
Requested Date: {{requestedDate}}
Requested Time: {{requestedTime}}
Reference: {{referenceNumber}}

{{#if declineReason}}
REASON:
{{declineReason}}
{{/if}}

WE'D STILL LOVE TO HELP
We apologize for any inconvenience. We encourage you to submit a new request for an alternative date and time that works better with our availability.

{{#if requestNewAppointmentLink}}
Request Another Time: {{requestNewAppointmentLink}}
{{/if}}

If you have any questions or would like assistance finding an available time slot, please don't hesitate to contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}. Our team is here to help you find a time that works.

Thank you for choosing {{tenantName}}

© {{currentYear}} {{tenantName}}. All rights reserved.`
    },

    // 4. New Appointment Request - To MSP staff
    {
      name: 'new-appointment-request',
      language_code: 'en',
      subject: 'New Appointment Request - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Appointment Request</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .container {
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
    }
    .header {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
    }
    .content {
      padding: 32px 24px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 16px 0;
    }
    .message {
      color: #475569;
      margin: 0 0 24px 0;
      font-size: 16px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 24px 0;
    }
    .info-card {
      background-color: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .info-card h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-card p {
      margin: 4px 0;
      color: #1e293b;
      font-size: 15px;
    }
    .info-card p strong {
      font-weight: 600;
    }
    .request-details {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 20px;
      margin: 24px 0;
      border-radius: 6px;
    }
    .request-details h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #92400e;
    }
    .detail-row {
      display: flex;
      margin-bottom: 12px;
      font-size: 15px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      font-weight: 600;
      color: #78350f;
      min-width: 140px;
    }
    .detail-value {
      color: #1e293b;
    }
    .description-box {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 16px;
      margin: 16px 0;
      border-radius: 6px;
    }
    .description-box h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      font-weight: 600;
      color: #475569;
    }
    .description-box p {
      margin: 0;
      color: #1e293b;
      font-size: 14px;
      font-style: italic;
    }
    .action-buttons {
      display: flex;
      gap: 12px;
      margin: 24px 0;
      justify-content: center;
    }
    .action-button {
      flex: 1;
      display: inline-block;
      padding: 14px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      text-align: center;
    }
    .approve-button {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
    }
    .approve-button:hover {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
    }
    .review-button {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
    }
    .review-button:hover {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
    }
    .footer {
      padding: 24px;
      text-align: center;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 8px 0;
      color: #64748b;
      font-size: 14px;
    }
    .footer .copyright {
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
    @media (max-width: 600px) {
      .info-grid {
        grid-template-columns: 1fr;
      }
      .action-buttons {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Appointment Request</h1>
      <p>Action Required</p>
      <div class="badge">{{#if isAuthenticated}}Client Portal{{else}}Public Request{{/if}}</div>
    </div>

    <div class="content">
      <p class="greeting">Team,</p>

      <p class="message">
        A new appointment request has been submitted and requires your review and approval.
      </p>

      <div class="info-grid">
        <div class="info-card">
          <h4>Requester Information</h4>
          <p><strong>{{requesterName}}</strong></p>
          <p>{{requesterEmail}}</p>
          {{#if requesterPhone}}<p>{{requesterPhone}}</p>{{/if}}
          {{#if companyName}}<p>Company: {{companyName}}</p>{{/if}}
          {{#if clientName}}<p>Client: {{clientName}}</p>{{/if}}
        </div>

        <div class="info-card">
          <h4>Request Details</h4>
          <p><strong>Reference:</strong> {{referenceNumber}}</p>
          <p><strong>Submitted:</strong> {{submittedAt}}</p>
          {{#if linkedTicket}}<p><strong>Ticket:</strong> #{{linkedTicket}}</p>{{/if}}
        </div>
      </div>

      <div class="request-details">
        <h3>Appointment Details</h3>
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Date:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested Time:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">{{duration}} minutes</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Preferred Technician:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if description}}
      <div class="description-box">
        <h4>Additional Notes</h4>
        <p>"{{description}}"</p>
      </div>
      {{/if}}

      <div class="action-buttons">
        {{#if approvalLink}}
        <a href="{{approvalLink}}" class="action-button review-button">Review & Approve</a>
        {{/if}}
      </div>

      <p class="message" style="text-align: center; font-size: 14px;">
        Please review this request and take appropriate action. The requester is waiting for confirmation.
      </p>
    </div>

    <div class="footer">
      <p>{{tenantName}} - Appointment Management</p>
      <p class="copyright">© {{currentYear}} {{tenantName}}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `,
      text_content: `New Appointment Request - Action Required

Team,

A new appointment request has been submitted and requires your review and approval.

REQUESTER INFORMATION:
Name: {{requesterName}}
Email: {{requesterEmail}}
{{#if requesterPhone}}Phone: {{requesterPhone}}{{/if}}
{{#if companyName}}Company: {{companyName}}{{/if}}
{{#if clientName}}Client: {{clientName}}{{/if}}

REQUEST DETAILS:
Reference: {{referenceNumber}}
Submitted: {{submittedAt}}
{{#if linkedTicket}}Ticket: #{{linkedTicket}}{{/if}}
Type: {{#if isAuthenticated}}Client Portal Request{{else}}Public Request{{/if}}

APPOINTMENT DETAILS:
Service: {{serviceName}}
Requested Date: {{requestedDate}}
Requested Time: {{requestedTime}}
Duration: {{duration}} minutes
{{#if preferredTechnician}}Preferred Technician: {{preferredTechnician}}{{/if}}

{{#if description}}
ADDITIONAL NOTES:
"{{description}}"
{{/if}}

{{#if approvalLink}}
REVIEW & APPROVE:
{{approvalLink}}
{{/if}}

Please review this request and take appropriate action. The requester is waiting for confirmation.

{{tenantName}} - Appointment Management
© {{currentYear}} {{tenantName}}. All rights reserved.`
    }
  ];

  // Insert templates
  await knex('system_email_templates')
    .insert(templates)
    .onConflict(['name', 'language_code'])
    .merge({
      subject: knex.raw('excluded.subject'),
      html_content: knex.raw('excluded.html_content'),
      text_content: knex.raw('excluded.text_content'),
      notification_subtype_id: knex.raw('excluded.notification_subtype_id')
    });

  console.log(`✓ Added ${templates.length} appointment request email templates (English)`);
  console.log('✓ Appointment request email templates migration completed successfully');
};

exports.down = async function(knex) {
  console.log('Removing appointment request email templates...');

  // Remove templates
  await knex('system_email_templates')
    .whereIn('name', [
      'appointment-request-received',
      'appointment-request-approved',
      'appointment-request-declined',
      'new-appointment-request'
    ])
    .del();

  // Remove notification subtypes
  await knex('notification_subtypes')
    .whereIn('name', [
      'appointment-request-received',
      'appointment-request-approved',
      'appointment-request-declined',
      'new-appointment-request'
    ])
    .del();

  // Remove category if it has no other subtypes
  const appointmentsCategory = await knex('notification_categories')
    .where({ name: 'Appointments' })
    .first();

  if (appointmentsCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: appointmentsCategory.id })
      .count('* as count')
      .first();

    if (remainingSubtypes && parseInt(remainingSubtypes.count) === 0) {
      await knex('notification_categories')
        .where({ id: appointmentsCategory.id })
        .del();
      console.log('✓ Removed Appointments notification category');
    }
  }

  console.log('✓ Appointment request email templates rollback completed');
};
