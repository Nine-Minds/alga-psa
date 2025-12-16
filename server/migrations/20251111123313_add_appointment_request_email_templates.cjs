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

If you have any questions or need to make changes to your request, please contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.`
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
      background: linear-gradient(135deg, #8A4DEA, #40CFF9);
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
      background: linear-gradient(135deg, #f8f5ff 0%, #ede9fe 100%);
      border: 2px solid #8A4DEA;
      padding: 24px;
      margin: 24px 0;
      border-radius: 8px;
      text-align: center;
    }
    .appointment-box h3 {
      margin: 0 0 20px 0;
      font-size: 18px;
      font-weight: 600;
      color: #5b38b0;
    }
    .appointment-detail {
      margin: 12px 0;
      font-size: 16px;
    }
    .appointment-detail strong {
      color: #5b38b0;
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
      background: #8A4DEA;
      color: #ffffff;
      padding: 14px 28px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      margin: 8px 0;
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

We'll send you a reminder before your appointment. See you soon!`
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
      background: linear-gradient(135deg, #8A4DEA, #40CFF9);
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

If you have any questions or would like assistance finding an available time slot, please don't hesitate to contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}. Our team is here to help you find a time that works.`
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
      background: linear-gradient(135deg, #8A4DEA, #40CFF9);
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
      background: #10b981;
      color: #ffffff;
    }
    .review-button {
      background: #8A4DEA;
      color: #ffffff;
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

Please review this request and take appropriate action. The requester is waiting for confirmation.`
    },

    // German (de) templates
    {
      name: 'appointment-request-received',
      language_code: 'de',
      subject: 'Terminanfrage erhalten - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terminanfrage erhalten</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8A4DEA, #40CFF9); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .header p { margin: 0; font-size: 16px; opacity: 0.95; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 16px 0; }
    .message { color: #475569; margin: 0 0 24px 0; font-size: 16px; }
    .details-box { background-color: #f8fafc; border-left: 4px solid #8a4dea; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .details-box h3 { margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1e293b; }
    .detail-row { display: flex; margin-bottom: 12px; font-size: 15px; }
    .detail-label { font-weight: 600; color: #475569; min-width: 120px; }
    .detail-value { color: #1e293b; }
    .reference-number { background-color: #ede9fe; color: #6d28d9; padding: 8px 16px; border-radius: 6px; font-weight: 600; display: inline-block; margin: 16px 0; font-size: 16px; }
    .info-box { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 6px; }
    .info-box p { margin: 0; color: #1e40af; font-size: 14px; }
    .footer { padding: 24px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
    .footer p { margin: 8px 0; color: #64748b; font-size: 14px; }
    .footer .copyright { margin-top: 16px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Anfrage erhalten</h1>
      <p>Wir haben Ihre Terminanfrage erhalten</p>
    </div>
    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p class="message">Vielen Dank für das Einreichen Ihrer Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in Kürze prüfen.</p>
      <div class="reference-number">Referenz: {{referenceNumber}}</div>
      <div class="details-box">
        <h3>Anfragedetails</h3>
        <div class="detail-row"><span class="detail-label">Service:</span><span class="detail-value">{{serviceName}}</span></div>
        <div class="detail-row"><span class="detail-label">Gewünschtes Datum:</span><span class="detail-value">{{requestedDate}}</span></div>
        <div class="detail-row"><span class="detail-label">Gewünschte Uhrzeit:</span><span class="detail-value">{{requestedTime}}</span></div>
        <div class="detail-row"><span class="detail-label">Dauer:</span><span class="detail-value">{{duration}} Minuten</span></div>
        {{#if preferredTechnician}}<div class="detail-row"><span class="detail-label">Bevorzugter Techniker:</span><span class="detail-value">{{preferredTechnician}}</span></div>{{/if}}
      </div>
      <div class="info-box">
        <p><strong>Was passiert als nächstes?</strong></p>
        <p>Unser Team wird Ihre Anfrage prüfen und die Verfügbarkeit bestätigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls Änderungen erforderlich sind. Wir antworten in der Regel innerhalb von {{responseTime}}.</p>
      </div>
      <p class="message">Wenn Sie Fragen haben oder Änderungen an Ihrer Anfrage vornehmen möchten, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.</p>
    </div>
    
  </div>
</body>
</html>`,
      text_content: `Terminanfrage erhalten

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Vielen Dank für das Einreichen Ihrer Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in Kürze prüfen.

Referenznummer: {{referenceNumber}}

ANFRAGEDETAILS:
Service: {{serviceName}}
Gewünschtes Datum: {{requestedDate}}
Gewünschte Uhrzeit: {{requestedTime}}
Dauer: {{duration}} Minuten
{{#if preferredTechnician}}Bevorzugter Techniker: {{preferredTechnician}}{{/if}}

WAS PASSIERT ALS NÄCHSTES?
Unser Team wird Ihre Anfrage prüfen und die Verfügbarkeit bestätigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls Änderungen erforderlich sind. Wir antworten in der Regel innerhalb von {{responseTime}}.

Wenn Sie Fragen haben oder Änderungen an Ihrer Anfrage vornehmen möchten, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'de',
      subject: 'Termin bestätigt - {{serviceName}} am {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Termin bestätigt</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8A4DEA, #40CFF9); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .checkmark { width: 64px; height: 64px; background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 32px; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 16px 0; }
    .message { color: #475569; margin: 0 0 24px 0; font-size: 16px; }
    .appointment-box { background: linear-gradient(135deg, #f8f5ff 0%, #ede9fe 100%); border: 2px solid #8A4DEA; padding: 24px; margin: 24px 0; border-radius: 8px; text-align: center; }
    .appointment-detail { margin: 12px 0; font-size: 16px; }
    .appointment-detail strong { color: #5b38b0; display: block; font-size: 14px; text-transform: uppercase; margin-bottom: 4px; }
    .appointment-detail span { color: #1e293b; font-size: 18px; font-weight: 600; }
    .policy-box { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 6px; }
    .footer { padding: 24px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="checkmark">✓</div>
      <h1>Termin bestätigt</h1>
      <p>Ihr Termin wurde genehmigt</p>
    </div>
    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p class="message">Gute Nachrichten! Ihre Terminanfrage wurde genehmigt und bestätigt. Wir freuen uns darauf, Sie zu bedienen.</p>
      <div class="appointment-box">
        <h3>Ihr Termin</h3>
        <div class="appointment-detail"><strong>Service</strong><span>{{serviceName}}</span></div>
        <div class="appointment-detail"><strong>Datum</strong><span>{{appointmentDate}}</span></div>
        <div class="appointment-detail"><strong>Uhrzeit</strong><span>{{appointmentTime}}</span></div>
        <div class="appointment-detail"><strong>Dauer</strong><span>{{duration}} Minuten</span></div>
      </div>
      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Stornierungsbedingungen</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}
      <p class="message">Wenn Sie diesen Termin verschieben oder stornieren möchten, kontaktieren Sie uns bitte mindestens {{minimumNoticeHours}} Stunden im Voraus unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.</p>
    </div>
    
  </div>
</body>
</html>`,
      text_content: `Termin bestätigt

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Gute Nachrichten! Ihre Terminanfrage wurde genehmigt und bestätigt. Wir freuen uns darauf, Sie zu bedienen.

IHR TERMIN:
Service: {{serviceName}}
Datum: {{appointmentDate}}
Uhrzeit: {{appointmentTime}}
Dauer: {{duration}} Minuten

{{#if technicianName}}
ZUGEWIESENER TECHNIKER:
{{technicianName}}
{{#if technicianEmail}}E-Mail: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Telefon: {{technicianPhone}}{{/if}}
{{/if}}

{{#if cancellationPolicy}}
STORNIERUNGSBEDINGUNGEN:
{{cancellationPolicy}}
{{/if}}

Wenn Sie diesen Termin verschieben oder stornieren möchten, kontaktieren Sie uns bitte mindestens {{minimumNoticeHours}} Stunden im Voraus unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'de',
      subject: 'Terminanfrage Aktualisierung - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Terminanfrage Aktualisierung</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8A4DEA, #40CFF9); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 16px 0; }
    .message { color: #475569; margin: 0 0 24px 0; font-size: 16px; }
    .reason-box { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 6px; }
    .action-box { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .footer { padding: 24px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Terminanfrage Aktualisierung</h1>
      <p>Bezüglich Ihrer kürzlichen Terminanfrage</p>
    </div>
    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p class="message">Vielen Dank für Ihr Interesse an einem Termin bei uns. Leider können wir Ihre Anfrage zum gewünschten Zeitpunkt nicht berücksichtigen.</p>
      {{#if declineReason}}
      <div class="reason-box">
        <h4>Grund</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}
      <div class="action-box">
        <h4>Wir helfen Ihnen gerne weiter</h4>
        <p>Wir entschuldigen uns für die Unannehmlichkeiten. Wir ermutigen Sie, eine neue Anfrage für ein alternatives Datum und eine alternative Uhrzeit einzureichen, die besser zu unserer Verfügbarkeit passen.</p>
      </div>
      <p class="message">Wenn Sie Fragen haben oder Hilfe bei der Suche nach einem verfügbaren Zeitfenster benötigen, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.</p>
    </div>
    
  </div>
</body>
</html>`,
      text_content: `Terminanfrage Aktualisierung

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Vielen Dank für Ihr Interesse an einem Termin bei uns. Leider können wir Ihre Anfrage zum gewünschten Zeitpunkt nicht berücksichtigen.

{{#if declineReason}}
GRUND:
{{declineReason}}
{{/if}}

WIR HELFEN IHNEN GERNE WEITER
Wir entschuldigen uns für die Unannehmlichkeiten. Wir ermutigen Sie, eine neue Anfrage für ein alternatives Datum und eine alternative Uhrzeit einzureichen.

Wenn Sie Fragen haben oder Hilfe bei der Suche nach einem verfügbaren Zeitfenster benötigen, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie an unter {{contactPhone}}{{/if}}.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'de',
      subject: 'Neue Terminanfrage - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Neue Terminanfrage</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8A4DEA, #40CFF9); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 16px 0; }
    .message { color: #475569; margin: 0 0 24px 0; font-size: 16px; }
    .request-details { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .footer { padding: 24px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Neue Terminanfrage</h1>
      <p>Aktion erforderlich</p>
    </div>
    <div class="content">
      <p class="greeting">Team,</p>
      <p class="message">Eine neue Terminanfrage wurde eingereicht und erfordert Ihre Prüfung und Genehmigung.</p>
      <div class="request-details">
        <h3>Termindetails</h3>
        <p><strong>Service:</strong> {{serviceName}}</p>
        <p><strong>Gewünschtes Datum:</strong> {{requestedDate}}</p>
        <p><strong>Gewünschte Uhrzeit:</strong> {{requestedTime}}</p>
        <p><strong>Dauer:</strong> {{duration}} Minuten</p>
      </div>
      <p class="message">Bitte prüfen Sie diese Anfrage und ergreifen Sie entsprechende Maßnahmen. Der Antragsteller wartet auf Bestätigung.</p>
    </div>
    
  </div>
</body>
</html>`,
      text_content: `Neue Terminanfrage - Aktion erforderlich

Team,

Eine neue Terminanfrage wurde eingereicht und erfordert Ihre Prüfung und Genehmigung.

ANFORDERER INFORMATIONEN:
Name: {{requesterName}}
E-Mail: {{requesterEmail}}
{{#if requesterPhone}}Telefon: {{requesterPhone}}{{/if}}
{{#if clientName}}Kunde: {{clientName}}{{/if}}

TERMINDETAILS:
Service: {{serviceName}}
Gewünschtes Datum: {{requestedDate}}
Gewünschte Uhrzeit: {{requestedTime}}
Dauer: {{duration}} Minuten

Bitte prüfen Sie diese Anfrage und ergreifen Sie entsprechende Maßnahmen.`
    },

    // Spanish (es), French (fr), Italian (it), Dutch (nl) templates
    // Due to length, these are condensed versions with key translations in subject and text_content
    // HTML content maintains minimal styling with translated text

    // Spanish (es)
    {
      name: 'appointment-request-received',
      language_code: 'es',
      subject: 'Solicitud de cita recibida - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Solicitud recibida</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#8a4dea;">Solicitud recibida</h1><p>Hola{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisará en breve.</p><p><strong>Referencia:</strong> {{referenceNumber}}</p><div style="background:#f8fafc;padding:20px;margin:20px 0;"><h3>Detalles de la solicitud</h3><p><strong>Servicio:</strong> {{serviceName}}</p><p><strong>Fecha solicitada:</strong> {{requestedDate}}</p><p><strong>Hora solicitada:</strong> {{requestedTime}}</p><p><strong>Duración:</strong> {{duration}} minutos</p></div><p>Si tiene preguntas, contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Solicitud de cita recibida

Hola{{#if requesterName}} {{requesterName}}{{/if}},

Gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisará en breve.

Número de referencia: {{referenceNumber}}

DETALLES DE LA SOLICITUD:
Servicio: {{serviceName}}
Fecha solicitada: {{requestedDate}}
Hora solicitada: {{requestedTime}}
Duración: {{duration}} minutos

Nuestro equipo revisará su solicitud y confirmará la disponibilidad. Recibirá una notificación por correo electrónico una vez que su cita haya sido aprobada.

Si tiene preguntas, contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'es',
      subject: 'Cita confirmada - {{serviceName}} el {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cita confirmada</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#10b981;">✓ Cita confirmada</h1><p>Hola{{#if requesterName}} {{requesterName}}{{/if}},</p><p>¡Buenas noticias! Su solicitud de cita ha sido aprobada y confirmada.</p><div style="background:#f0fdf4;border:2px solid #10b981;padding:20px;margin:20px 0;text-align:center;"><h3>Su cita</h3><p><strong>Servicio:</strong> {{serviceName}}</p><p><strong>Fecha:</strong> {{appointmentDate}}</p><p><strong>Hora:</strong> {{appointmentTime}}</p><p><strong>Duración:</strong> {{duration}} minutos</p></div>{{#if technicianName}}<p><strong>Técnico asignado:</strong> {{technicianName}}</p>{{/if}}<p>Si necesita reprogramar o cancelar, contáctenos con al menos {{minimumNoticeHours}} horas de anticipación en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Cita confirmada

Hola{{#if requesterName}} {{requesterName}}{{/if}},

¡Buenas noticias! Su solicitud de cita ha sido aprobada y confirmada.

SU CITA:
Servicio: {{serviceName}}
Fecha: {{appointmentDate}}
Hora: {{appointmentTime}}
Duración: {{duration}} minutos

{{#if technicianName}}
TÉCNICO ASIGNADO:
{{technicianName}}
{{#if technicianEmail}}Correo: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Teléfono: {{technicianPhone}}{{/if}}
{{/if}}

Si necesita reprogramar o cancelar, contáctenos con al menos {{minimumNoticeHours}} horas de anticipación.`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'es',
      subject: 'Actualización de solicitud de cita - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Actualización de cita</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1>Actualización de solicitud de cita</h1><p>Hola{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Gracias por su interés. Lamentablemente, no podemos acomodar su solicitud en el momento solicitado.</p>{{#if declineReason}}<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;margin:20px 0;"><h4>Motivo</h4><p>{{declineReason}}</p></div>{{/if}}<p>Le animamos a enviar una nueva solicitud para una fecha y hora alternativa.</p><p>Si tiene preguntas, contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Actualización de solicitud de cita

Hola{{#if requesterName}} {{requesterName}}{{/if}},

Gracias por su interés. Lamentablemente, no podemos acomodar su solicitud en el momento solicitado.

{{#if declineReason}}
MOTIVO:
{{declineReason}}
{{/if}}

Le animamos a enviar una nueva solicitud para una fecha y hora alternativa que funcione mejor con nuestra disponibilidad.

Si tiene preguntas, contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'es',
      subject: 'Nueva solicitud de cita - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nueva solicitud</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#f59e0b;">Nueva solicitud de cita</h1><p>Equipo,</p><p>Se ha enviado una nueva solicitud de cita que requiere su revisión y aprobación.</p><div style="background:#fef3c7;padding:20px;margin:20px 0;"><h3>Detalles de la cita</h3><p><strong>Servicio:</strong> {{serviceName}}</p><p><strong>Fecha solicitada:</strong> {{requestedDate}}</p><p><strong>Hora solicitada:</strong> {{requestedTime}}</p><p><strong>Duración:</strong> {{duration}} minutos</p></div><p>Por favor revise esta solicitud y tome las medidas apropiadas.</p></body></html>`,
      text_content: `Nueva solicitud de cita - Acción requerida

Equipo,

Se ha enviado una nueva solicitud de cita que requiere su revisión y aprobación.

DETALLES DE LA CITA:
Servicio: {{serviceName}}
Fecha solicitada: {{requestedDate}}
Hora solicitada: {{requestedTime}}
Duración: {{duration}} minutos

Por favor revise esta solicitud y tome las medidas apropiadas.`
    },

    // French (fr)
    {
      name: 'appointment-request-received',
      language_code: 'fr',
      subject: 'Demande de rendez-vous reçue - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Demande reçue</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#8a4dea;">Demande reçue</h1><p>Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Merci d'avoir soumis votre demande de rendez-vous. Nous avons reçu votre demande et notre équipe l'examinera sous peu.</p><p><strong>Référence :</strong> {{referenceNumber}}</p><div style="background:#f8fafc;padding:20px;margin:20px 0;"><h3>Détails de la demande</h3><p><strong>Service :</strong> {{serviceName}}</p><p><strong>Date demandée :</strong> {{requestedDate}}</p><p><strong>Heure demandée :</strong> {{requestedTime}}</p><p><strong>Durée :</strong> {{duration}} minutes</p></div><p>Si vous avez des questions, contactez-nous à {{contactEmail}}{{#if contactPhone}} ou appelez au {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Demande de rendez-vous reçue

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Merci d'avoir soumis votre demande de rendez-vous. Nous avons reçu votre demande et notre équipe l'examinera sous peu.

Numéro de référence : {{referenceNumber}}

DÉTAILS DE LA DEMANDE :
Service : {{serviceName}}
Date demandée : {{requestedDate}}
Heure demandée : {{requestedTime}}
Durée : {{duration}} minutes

Notre équipe examinera votre demande et confirmera la disponibilité. Vous recevrez une notification par e-mail une fois votre rendez-vous approuvé.

Si vous avez des questions, contactez-nous à {{contactEmail}}{{#if contactPhone}} ou appelez au {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'fr',
      subject: 'Rendez-vous confirmé - {{serviceName}} le {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rendez-vous confirmé</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#10b981;">✓ Rendez-vous confirmé</h1><p>Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Bonne nouvelle ! Votre demande de rendez-vous a été approuvée et confirmée.</p><div style="background:#f0fdf4;border:2px solid #10b981;padding:20px;margin:20px 0;text-align:center;"><h3>Votre rendez-vous</h3><p><strong>Service :</strong> {{serviceName}}</p><p><strong>Date :</strong> {{appointmentDate}}</p><p><strong>Heure :</strong> {{appointmentTime}}</p><p><strong>Durée :</strong> {{duration}} minutes</p></div>{{#if technicianName}}<p><strong>Technicien assigné :</strong> {{technicianName}}</p>{{/if}}<p>Si vous devez reporter ou annuler, contactez-nous au moins {{minimumNoticeHours}} heures à l'avance à {{contactEmail}}{{#if contactPhone}} ou appelez au {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Rendez-vous confirmé

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Bonne nouvelle ! Votre demande de rendez-vous a été approuvée et confirmée.

VOTRE RENDEZ-VOUS :
Service : {{serviceName}}
Date : {{appointmentDate}}
Heure : {{appointmentTime}}
Durée : {{duration}} minutes

{{#if technicianName}}
TECHNICIEN ASSIGNÉ :
{{technicianName}}
{{#if technicianEmail}}E-mail : {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Téléphone : {{technicianPhone}}{{/if}}
{{/if}}

Si vous devez reporter ou annuler, contactez-nous au moins {{minimumNoticeHours}} heures à l'avance.`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'fr',
      subject: 'Mise à jour de la demande de rendez-vous - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mise à jour</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1>Mise à jour de la demande</h1><p>Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Merci de votre intérêt. Malheureusement, nous ne pouvons pas accepter votre demande au moment demandé.</p>{{#if declineReason}}<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;margin:20px 0;"><h4>Raison</h4><p>{{declineReason}}</p></div>{{/if}}<p>Nous vous encourageons à soumettre une nouvelle demande pour une date et une heure alternatives.</p><p>Si vous avez des questions, contactez-nous à {{contactEmail}}{{#if contactPhone}} ou appelez au {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Mise à jour de la demande de rendez-vous

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Merci de votre intérêt. Malheureusement, nous ne pouvons pas accepter votre demande au moment demandé.

{{#if declineReason}}
RAISON :
{{declineReason}}
{{/if}}

Nous vous encourageons à soumettre une nouvelle demande pour une date et une heure alternatives qui correspondent mieux à notre disponibilité.

Si vous avez des questions, contactez-nous à {{contactEmail}}{{#if contactPhone}} ou appelez au {{contactPhone}}{{/if}}.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'fr',
      subject: 'Nouvelle demande de rendez-vous - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nouvelle demande</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#f59e0b;">Nouvelle demande de rendez-vous</h1><p>Équipe,</p><p>Une nouvelle demande de rendez-vous a été soumise et nécessite votre examen et approbation.</p><div style="background:#fef3c7;padding:20px;margin:20px 0;"><h3>Détails du rendez-vous</h3><p><strong>Service :</strong> {{serviceName}}</p><p><strong>Date demandée :</strong> {{requestedDate}}</p><p><strong>Heure demandée :</strong> {{requestedTime}}</p><p><strong>Durée :</strong> {{duration}} minutes</p></div><p>Veuillez examiner cette demande et prendre les mesures appropriées.</p></body></html>`,
      text_content: `Nouvelle demande de rendez-vous - Action requise

Équipe,

Une nouvelle demande de rendez-vous a été soumise et nécessite votre examen et approbation.

DÉTAILS DU RENDEZ-VOUS :
Service : {{serviceName}}
Date demandée : {{requestedDate}}
Heure demandée : {{requestedTime}}
Durée : {{duration}} minutes

Veuillez examiner cette demande et prendre les mesures appropriées.`
    },

    // Italian (it)
    {
      name: 'appointment-request-received',
      language_code: 'it',
      subject: 'Richiesta di appuntamento ricevuta - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Richiesta ricevuta</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#8a4dea;">Richiesta ricevuta</h1><p>Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Grazie per aver inviato la tua richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminerà a breve.</p><p><strong>Riferimento:</strong> {{referenceNumber}}</p><div style="background:#f8fafc;padding:20px;margin:20px 0;"><h3>Dettagli della richiesta</h3><p><strong>Servizio:</strong> {{serviceName}}</p><p><strong>Data richiesta:</strong> {{requestedDate}}</p><p><strong>Ora richiesta:</strong> {{requestedTime}}</p><p><strong>Durata:</strong> {{duration}} minuti</p></div><p>Per domande, contattaci a {{contactEmail}}{{#if contactPhone}} o chiama {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Richiesta di appuntamento ricevuta

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Grazie per aver inviato la tua richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminerà a breve.

Numero di riferimento: {{referenceNumber}}

DETTAGLI DELLA RICHIESTA:
Servizio: {{serviceName}}
Data richiesta: {{requestedDate}}
Ora richiesta: {{requestedTime}}
Durata: {{duration}} minuti

Il nostro team esaminerà la tua richiesta e confermerà la disponibilità. Riceverai una notifica via email una volta che il tuo appuntamento sarà stato approvato.

Per domande, contattaci a {{contactEmail}}{{#if contactPhone}} o chiama {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'it',
      subject: 'Appuntamento confermato - {{serviceName}} il {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Appuntamento confermato</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#10b981;">✓ Appuntamento confermato</h1><p>Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Buone notizie! La tua richiesta di appuntamento è stata approvata e confermata.</p><div style="background:#f0fdf4;border:2px solid #10b981;padding:20px;margin:20px 0;text-align:center;"><h3>Il tuo appuntamento</h3><p><strong>Servizio:</strong> {{serviceName}}</p><p><strong>Data:</strong> {{appointmentDate}}</p><p><strong>Ora:</strong> {{appointmentTime}}</p><p><strong>Durata:</strong> {{duration}} minuti</p></div>{{#if technicianName}}<p><strong>Tecnico assegnato:</strong> {{technicianName}}</p>{{/if}}<p>Se devi riprogrammare o annullare, contattaci almeno {{minimumNoticeHours}} ore prima a {{contactEmail}}{{#if contactPhone}} o chiama {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Appuntamento confermato

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Buone notizie! La tua richiesta di appuntamento è stata approvata e confermata.

IL TUO APPUNTAMENTO:
Servizio: {{serviceName}}
Data: {{appointmentDate}}
Ora: {{appointmentTime}}
Durata: {{duration}} minuti

{{#if technicianName}}
TECNICO ASSEGNATO:
{{technicianName}}
{{#if technicianEmail}}Email: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Telefono: {{technicianPhone}}{{/if}}
{{/if}}

Se devi riprogrammare o annullare, contattaci almeno {{minimumNoticeHours}} ore prima.`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'it',
      subject: 'Aggiornamento richiesta di appuntamento - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aggiornamento</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1>Aggiornamento richiesta</h1><p>Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Grazie per il tuo interesse. Purtroppo, non possiamo accogliere la tua richiesta al momento richiesto.</p>{{#if declineReason}}<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;margin:20px 0;"><h4>Motivo</h4><p>{{declineReason}}</p></div>{{/if}}<p>Ti incoraggiamo a inviare una nuova richiesta per una data e ora alternative.</p><p>Per domande, contattaci a {{contactEmail}}{{#if contactPhone}} o chiama {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Aggiornamento richiesta di appuntamento

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Grazie per il tuo interesse. Purtroppo, non possiamo accogliere la tua richiesta al momento richiesto.

{{#if declineReason}}
MOTIVO:
{{declineReason}}
{{/if}}

Ti incoraggiamo a inviare una nuova richiesta per una data e ora alternative che si adattino meglio alla nostra disponibilità.

Per domande, contattaci a {{contactEmail}}{{#if contactPhone}} o chiama {{contactPhone}}{{/if}}.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'it',
      subject: 'Nuova richiesta di appuntamento - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nuova richiesta</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#f59e0b;">Nuova richiesta di appuntamento</h1><p>Team,</p><p>È stata inviata una nuova richiesta di appuntamento che richiede la vostra revisione e approvazione.</p><div style="background:#fef3c7;padding:20px;margin:20px 0;"><h3>Dettagli dell'appuntamento</h3><p><strong>Servizio:</strong> {{serviceName}}</p><p><strong>Data richiesta:</strong> {{requestedDate}}</p><p><strong>Ora richiesta:</strong> {{requestedTime}}</p><p><strong>Durata:</strong> {{duration}} minuti</p></div><p>Si prega di rivedere questa richiesta e prendere le misure appropriate.</p></body></html>`,
      text_content: `Nuova richiesta di appuntamento - Azione richiesta

Team,

È stata inviata una nuova richiesta di appuntamento che richiede la vostra revisione e approvazione.

DETTAGLI DELL'APPUNTAMENTO:
Servizio: {{serviceName}}
Data richiesta: {{requestedDate}}
Ora richiesta: {{requestedTime}}
Durata: {{duration}} minuti

Si prega di rivedere questa richiesta e prendere le misure appropriate.`
    },

    // Dutch (nl)
    {
      name: 'appointment-request-received',
      language_code: 'nl',
      subject: 'Afspraakverzoek ontvangen - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-received'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verzoek ontvangen</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#8a4dea;">Verzoek ontvangen</h1><p>Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Bedankt voor het indienen van uw afspraakverzoek. Wij hebben uw verzoek ontvangen en ons team zal deze binnenkort beoordelen.</p><p><strong>Referentie:</strong> {{referenceNumber}}</p><div style="background:#f8fafc;padding:20px;margin:20px 0;"><h3>Verzoekdetails</h3><p><strong>Service:</strong> {{serviceName}}</p><p><strong>Gewenste datum:</strong> {{requestedDate}}</p><p><strong>Gewenste tijd:</strong> {{requestedTime}}</p><p><strong>Duur:</strong> {{duration}} minuten</p></div><p>Voor vragen, neem contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Afspraakverzoek ontvangen

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Bedankt voor het indienen van uw afspraakverzoek. Wij hebben uw verzoek ontvangen en ons team zal deze binnenkort beoordelen.

Referentienummer: {{referenceNumber}}

VERZOEKDETAILS:
Service: {{serviceName}}
Gewenste datum: {{requestedDate}}
Gewenste tijd: {{requestedTime}}
Duur: {{duration}} minuten

Ons team zal uw verzoek beoordelen en de beschikbaarheid bevestigen. U ontvangt een e-mailmelding zodra uw afspraak is goedgekeurd.

Voor vragen, neem contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'nl',
      subject: 'Afspraak bevestigd - {{serviceName}} op {{appointmentDate}}',
      notification_subtype_id: subtypeIds['appointment-request-approved'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Afspraak bevestigd</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#10b981;">✓ Afspraak bevestigd</h1><p>Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Goed nieuws! Uw afspraakverzoek is goedgekeurd en bevestigd.</p><div style="background:#f0fdf4;border:2px solid #10b981;padding:20px;margin:20px 0;text-align:center;"><h3>Uw afspraak</h3><p><strong>Service:</strong> {{serviceName}}</p><p><strong>Datum:</strong> {{appointmentDate}}</p><p><strong>Tijd:</strong> {{appointmentTime}}</p><p><strong>Duur:</strong> {{duration}} minuten</p></div>{{#if technicianName}}<p><strong>Toegewezen technicus:</strong> {{technicianName}}</p>{{/if}}<p>Als u moet verzetten of annuleren, neem dan minstens {{minimumNoticeHours}} uur van tevoren contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Afspraak bevestigd

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Goed nieuws! Uw afspraakverzoek is goedgekeurd en bevestigd.

UW AFSPRAAK:
Service: {{serviceName}}
Datum: {{appointmentDate}}
Tijd: {{appointmentTime}}
Duur: {{duration}} minuten

{{#if technicianName}}
TOEGEWEZEN TECHNICUS:
{{technicianName}}
{{#if technicianEmail}}E-mail: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Telefoon: {{technicianPhone}}{{/if}}
{{/if}}

Als u moet verzetten of annuleren, neem dan minstens {{minimumNoticeHours}} uur van tevoren contact op.`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'nl',
      subject: 'Update afspraakverzoek - {{serviceName}}',
      notification_subtype_id: subtypeIds['appointment-request-declined'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Update</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1>Update afspraakverzoek</h1><p>Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p><p>Bedankt voor uw interesse. Helaas kunnen wij uw verzoek op het gevraagde tijdstip niet accommoderen.</p>{{#if declineReason}}<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;margin:20px 0;"><h4>Reden</h4><p>{{declineReason}}</p></div>{{/if}}<p>Wij moedigen u aan om een nieuw verzoek in te dienen voor een alternatieve datum en tijd.</p><p>Voor vragen, neem contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.</p></body></html>`,
      text_content: `Update afspraakverzoek

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Bedankt voor uw interesse. Helaas kunnen wij uw verzoek op het gevraagde tijdstip niet accommoderen.

{{#if declineReason}}
REDEN:
{{declineReason}}
{{/if}}

Wij moedigen u aan om een nieuw verzoek in te dienen voor een alternatieve datum en tijd die beter past bij onze beschikbaarheid.

Voor vragen, neem contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'nl',
      subject: 'Nieuw afspraakverzoek - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: subtypeIds['new-appointment-request'],
      html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nieuw verzoek</title></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h1 style="color:#f59e0b;">Nieuw afspraakverzoek</h1><p>Team,</p><p>Er is een nieuw afspraakverzoek ingediend dat uw beoordeling en goedkeuring vereist.</p><div style="background:#fef3c7;padding:20px;margin:20px 0;"><h3>Afspraakdetails</h3><p><strong>Service:</strong> {{serviceName}}</p><p><strong>Gewenste datum:</strong> {{requestedDate}}</p><p><strong>Gewenste tijd:</strong> {{requestedTime}}</p><p><strong>Duur:</strong> {{duration}} minuten</p></div><p>Gelieve dit verzoek te beoordelen en passende actie te ondernemen.</p></body></html>`,
      text_content: `Nieuw afspraakverzoek - Actie vereist

Team,

Er is een nieuw afspraakverzoek ingediend dat uw beoordeling en goedkeuring vereist.

AFSPRAAKDETAILS:
Service: {{serviceName}}
Gewenste datum: {{requestedDate}}
Gewenste tijd: {{requestedTime}}
Duur: {{duration}} minuten

Gelieve dit verzoek te beoordelen en passende actie te ondernemen.`
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
