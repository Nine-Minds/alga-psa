/**
 * Add German translations for client-facing email templates
 *
 * Translates authentication, ticketing, and billing email templates to German
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding German email templates...');

  // Get notification subtypes
  const subtypes = await knex('notification_subtypes')
    .select('id', 'name')
    .whereIn('name', [
      'email-verification',
      'password-reset',
      'portal-invitation',
      'tenant-recovery',
      'no-account-found',
      'Ticket Assigned',
      'Ticket Created',
      'Ticket Updated',
      'Ticket Closed',
      'Ticket Comment Added',
      'Invoice Generated',
      'Payment Received',
      'Payment Overdue'
    ]);

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  // Insert German templates
  await knex('system_email_templates').insert([
    // Authentication templates
    {
      name: 'email-verification',
      language_code: 'de',
      subject: 'Verifizieren Sie Ihre E-Mail{{#if registrationClientName}} für {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>E-Mail-Verifizierung</h2>
          <p>Hallo,</p>
          <p>Bitte verifizieren Sie Ihre E-Mail-Adresse, indem Sie auf den untenstehenden Link klicken:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">E-Mail verifizieren</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Dieser Link läuft in {{expirationTime}} ab.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie bitte.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `E-Mail-Verifizierung

Bitte verifizieren Sie Ihre E-Mail-Adresse unter:
{{verificationUrl}}

{{#if expirationTime}}Dieser Link läuft in {{expirationTime}} ab.{{/if}}

Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie bitte.

© {{currentYear}} {{tenantClientName}}`
    },
    {
      name: 'password-reset',
      language_code: 'de',
      subject: 'Passwort-Zurücksetzungsanfrage',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Passwort-Zurücksetzungsanfrage</title>
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
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
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
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .security-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .security-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .security-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning ul {
      margin: 0;
      padding-left: 20px;
      color: #92400e;
    }
    .warning li {
      margin: 4px 0;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .code {
      font-family: 'Courier New', monospace;
      background: #e2e8f0;
      padding: 4px 8px;
      border-radius: 4px;
      color: #0f172a;
      font-size: 14px;
      font-weight: 600;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
    .help-section {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .help-section h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .help-section p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Passwort-Zurücksetzungsanfrage</h1>
    <p>Sichere Passwortwiederherstellung für Ihr Konto</p>
  </div>

  <div class="content">
    <h2>Hallo {{userName}},</h2>

    <p>Wir haben eine Anfrage erhalten, das Passwort für Ihr Konto zurückzusetzen, das mit <strong>{{email}}</strong> verknüpft ist.</p>

    <div class="security-box">
      <h3>🔐 Kontosicherheitsüberprüfung</h3>
      <p><strong>Angefordert:</strong> Vor einem Moment</p>
      <p><strong>Konto-E-Mail:</strong> {{email}}</p>
      <p><strong>Gültig für:</strong> {{expirationTime}}</p>
    </div>

    <p>Um ein neues Passwort für Ihr Konto zu erstellen, klicken Sie auf die Schaltfläche unten:</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Ihr Passwort Zurücksetzen</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Oder kopieren Sie diesen Link in Ihren Browser:
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Wichtige Sicherheitsinformationen</h4>
      <ul>
        <li>Dieser Zurücksetzungslink läuft in <strong>{{expirationTime}}</strong> ab</li>
        <li>Aus Sicherheitsgründen kann dieser Link nur <strong>einmal</strong> verwendet werden</li>
        <li>Wenn Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail</li>
        <li>Ihr Passwort wird nicht geändert, bis Sie ein neues erstellen</li>
      </ul>
    </div>

    <h3>Was kommt als Nächstes?</h3>
    <ol>
      <li>Klicken Sie auf die Zurücksetzungsschaltfläche oben oder verwenden Sie den bereitgestellten Link</li>
      <li>Erstellen Sie ein starkes, einzigartiges Passwort für Ihr Konto</li>
      <li>Sie werden nach dem Zurücksetzen automatisch angemeldet</li>
      <li>Alle bestehenden Sitzungen werden aus Sicherheitsgründen beendet</li>
      <li>Erwägen Sie die Aktivierung der Zwei-Faktor-Authentifizierung für zusätzlichen Schutz</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>Benötigen Sie Hilfe?</h4>
      <p>Wenn Sie Probleme beim Zurücksetzen Ihres Passworts haben, steht Ihnen unser Support-Team zur Verfügung.</p>
      <p style="margin-top: 12px;"><strong>Support kontaktieren:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>Dies ist eine automatische Sicherheits-E-Mail, die an {{email}} gesendet wurde.</p>
    <p>Zu Ihrer Sicherheit fügen wir niemals Passwörter in E-Mails ein.</p>
    <p>© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.</p>
  </div>
</body>
</html>
      `,
      text_content: `Passwort-Zurücksetzungsanfrage

Hallo {{userName}},

Wir haben eine Anfrage erhalten, das Passwort für Ihr Konto zurückzusetzen, das mit {{email}} verknüpft ist.

KONTOSICHERHEITSÜBERPRÜFUNG
- Angefordert: Vor einem Moment
- Konto-E-Mail: {{email}}
- Gültig für: {{expirationTime}}

Um ein neues Passwort zu erstellen, besuchen Sie den folgenden Link:
{{resetLink}}

WICHTIGE SICHERHEITSINFORMATIONEN:
- Dieser Link läuft in {{expirationTime}} ab
- Kann nur einmal verwendet werden
- Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail
- Ihr Passwort wird nicht geändert, bis Sie ein neues erstellen

WAS KOMMT ALS NÄCHSTES:
1. Verwenden Sie den oben bereitgestellten Link
2. Erstellen Sie ein starkes, einzigartiges Passwort
3. Sie werden automatisch angemeldet
4. Alle bestehenden Sitzungen werden beendet
5. Erwägen Sie die Aktivierung der Zwei-Faktor-Authentifizierung

Benötigen Sie Hilfe?
Support kontaktieren: {{supportEmail}}

---
Dies ist eine automatische Sicherheits-E-Mail, die an {{email}} gesendet wurde.
© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.`
    },
    {
      name: 'portal-invitation',
      language_code: 'de',
      subject: 'Kundenportal-Einladung - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Willkommen in Ihrem Kundenportal</h2>
          <p>Hallo {{contactName}},</p>
          <p>Sie wurden eingeladen, dem Kundenportal von {{clientName}} beizutreten.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Zugang aktivieren</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{portalLink}}</p>
          <p><small>Der Link läuft in {{expirationTime}} ab.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Benötigen Sie Unterstützung?</p>
          <p style="color: #666; font-size: 12px;">E-Mail: {{clientLocationEmail}}<br>Telefon: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Willkommen in Ihrem Kundenportal

Hallo {{contactName}},

Sie wurden eingeladen, dem Kundenportal von {{clientName}} beizutreten.

Zugang aktivieren: {{portalLink}}

Der Link läuft in {{expirationTime}} ab.

Benötigen Sie Unterstützung?
E-Mail: {{clientLocationEmail}}
Telefon: {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'tenant-recovery',
      language_code: 'de',
      subject: '{{platformName}} - Ihre Anmeldelinks',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
              {{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verknüpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie diese Anmeldelinks nicht angefordert haben, können Sie diese E-Mail sicher ignorieren. Ihr Konto bleibt sicher.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Bei Fragen oder für Unterstützung wenden Sie sich bitte an das Support-Team Ihrer Organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Ihre Anmeldelinks

Hallo,

Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
{{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verknüpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}

Ihre Anmeldelinks:
{{tenantLinksText}}

Sicherheitshinweis: Wenn Sie diese Anmeldelinks nicht angefordert haben, können Sie diese E-Mail sicher ignorieren.

Bei Fragen oder für Unterstützung wenden Sie sich bitte an das Support-Team Ihrer Organisation.

---
© {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`
    },
    {
      name: 'no-account-found',
      language_code: 'de',
      subject: '{{platformName}} - Zugriffsanfrage',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Wir haben eine Anfrage für den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Wenn Sie keine Anmelde-E-Mail erhalten haben, könnte dies bedeuten:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verknüpft</li>
              <li>Ihr Konto könnte inaktiv sein</li>
              <li>Die E-Mail könnte in Ihrem Spam-Ordner gefiltert worden sein</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Benötigen Sie Hilfe?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie keinen Zugriff angefordert haben, können Sie diese E-Mail sicher ignorieren.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Zugriffsanfrage

Hallo,

Wir haben eine Anfrage für den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.

Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.

Wenn Sie keine Anmelde-E-Mail erhalten haben, könnte dies bedeuten:
- Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verknüpft
- Ihr Konto könnte inaktiv sein
- Die E-Mail könnte in Ihrem Spam-Ordner gefiltert worden sein

Benötigen Sie Hilfe?
Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.

Sicherheitshinweis: Wenn Sie keinen Zugriff angefordert haben, können Sie diese E-Mail sicher ignorieren.

---
© {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'de',
      subject: 'Ticket Zugewiesen • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Zugewiesen</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Dieses Ticket wurde Ihnen für <strong>{{ticket.clientName}}</strong> zugewiesen. Überprüfen Sie die Details unten und ergreifen Sie Maßnahmen.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorität</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen von</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen an</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Anforderer</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Standort</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Beschreibung</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Anzeigen</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams auf Kurs halten</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Zugewiesen an Sie

{{ticket.metaLine}}
Zugewiesen von: {{ticket.assignedBy}}

Priorität: {{ticket.priority}}
Status: {{ticket.status}}
Zugewiesen an: {{ticket.assignedDetails}}
Anforderer: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Kategorie: {{ticket.categoryDetails}}
Standort: {{ticket.locationSummary}}

Beschreibung:
{{ticket.description}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'de',
      subject: 'Neues Ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Neues Ticket Erstellt</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ein neues Ticket wurde für <strong>{{ticket.clientName}}</strong> registriert. Überprüfen Sie die Zusammenfassung unten und folgen Sie dem Link, um Maßnahmen zu ergreifen.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorität</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Erstellt</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen an</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Anforderer</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Standort</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Beschreibung</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Anzeigen</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams auf Kurs halten</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Neues Ticket Erstellt für {{ticket.clientName}}

{{ticket.metaLine}}
Erstellt: {{ticket.createdAt}} · {{ticket.createdBy}}

Priorität: {{ticket.priority}}
Status: {{ticket.status}}
Zugewiesen an: {{ticket.assignedDetails}}
Anforderer: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Kategorie: {{ticket.categoryDetails}}
Standort: {{ticket.locationSummary}}

Beschreibung:
{{ticket.description}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'de',
      subject: 'Ticket Aktualisiert • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Aktualisiert</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ein Ticket wurde für <strong>{{ticket.clientName}}</strong> aktualisiert. Überprüfen Sie die Änderungen unten.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorität</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aktualisiert von</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen an</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Anforderer</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Standort</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Änderungen</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Anzeigen</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams auf Kurs halten</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Aktualisiert

{{ticket.metaLine}}
Aktualisiert von: {{ticket.updatedBy}}

Priorität: {{ticket.priority}}
Status: {{ticket.status}}
Zugewiesen an: {{ticket.assignedDetails}}
Anforderer: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Kategorie: {{ticket.categoryDetails}}
Standort: {{ticket.locationSummary}}

Änderungen:
{{ticket.changes}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'de',
      subject: 'Ticket Geschlossen • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Geschlossen</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ein Ticket wurde für <strong>{{ticket.clientName}}</strong> gelöst und geschlossen. Überprüfen Sie die Lösungsdetails unten.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Geschlossen</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Geschlossen von</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen an</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Anforderer</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Standort</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Lösung</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Anzeigen</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Teams auf Kurs halten</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Geschlossen

{{ticket.metaLine}}
Geschlossen von: {{ticket.closedBy}}

Status: Geschlossen
Zugewiesen an: {{ticket.assignedDetails}}
Anforderer: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Kategorie: {{ticket.categoryDetails}}
Standort: {{ticket.locationSummary}}

Lösung:
{{ticket.resolution}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'de',
      subject: 'Neuer Kommentar • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Neuer Kommentar Hinzugefügt</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ein neuer Kommentar wurde zu einem Ticket für <strong>{{ticket.clientName}}</strong> hinzugefügt.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorität</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kommentar von</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zugewiesen an</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Anforderer</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Standort</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Kommentar</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Anzeigen</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams auf Kurs halten</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Neuer Kommentar Hinzugefügt

{{ticket.metaLine}}
Kommentar von: {{comment.author}}

Priorität: {{ticket.priority}}
Status: {{ticket.status}}
Zugewiesen an: {{ticket.assignedDetails}}
Anforderer: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Kategorie: {{ticket.categoryDetails}}
Standort: {{ticket.locationSummary}}

Kommentar:
{{comment.content}}

Ticket anzeigen: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'de',
      subject: 'Neue Rechnung #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Rechnung {{invoice.number}}</h2>
        <p>Eine neue Rechnung wurde zur Überprüfung erstellt:</p>
        <div class="details">
          <p><strong>Rechnungsnummer:</strong> {{invoice.number}}</p>
          <p><strong>Betrag:</strong> {{invoice.amount}}</p>
          <p><strong>Fälligkeitsdatum:</strong> {{invoice.dueDate}}</p>
          <p><strong>Kunde:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Rechnung anzeigen</a>
      `,
      text_content: `
Rechnung {{invoice.number}}

Eine neue Rechnung wurde zur Überprüfung erstellt:

Rechnungsnummer: {{invoice.number}}
Betrag: {{invoice.amount}}
Fälligkeitsdatum: {{invoice.dueDate}}
Kunde: {{invoice.clientName}}

Rechnung anzeigen: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'de',
      subject: 'Zahlung erhalten: Rechnung #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Zahlung erhalten</h2>
        <p>Die Zahlung für Rechnung #{{invoice.number}} wurde erhalten:</p>
        <div class="details">
          <p><strong>Rechnungsnummer:</strong> {{invoice.number}}</p>
          <p><strong>Gezahlter Betrag:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Zahlungsdatum:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Zahlungsmethode:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Rechnung anzeigen</a>
      `,
      text_content: `
Zahlung erhalten

Die Zahlung für Rechnung #{{invoice.number}} wurde erhalten:

Rechnungsnummer: {{invoice.number}}
Gezahlter Betrag: {{invoice.amountPaid}}
Zahlungsdatum: {{invoice.paymentDate}}
Zahlungsmethode: {{invoice.paymentMethod}}

Rechnung anzeigen: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'de',
      subject: 'Zahlung überfällig: Rechnung #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Zahlung überfällig</h2>
        <p>Die Zahlung für Rechnung #{{invoice.number}} ist überfällig:</p>
        <div class="details">
          <p><strong>Rechnungsnummer:</strong> {{invoice.number}}</p>
          <p><strong>Fälliger Betrag:</strong> {{invoice.amountDue}}</p>
          <p><strong>Fälligkeitsdatum:</strong> {{invoice.dueDate}}</p>
          <p><strong>Tage überfällig:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Rechnung anzeigen</a>
      `,
      text_content: `
Zahlung überfällig

Die Zahlung für Rechnung #{{invoice.number}} ist überfällig:

Rechnungsnummer: {{invoice.number}}
Fälliger Betrag: {{invoice.amountDue}}
Fälligkeitsdatum: {{invoice.dueDate}}
Tage überfällig: {{invoice.daysOverdue}}

Rechnung anzeigen: {{invoice.url}}
      `
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ German email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove German email templates
  await knex('system_email_templates')
    .where({ language_code: 'de' })
    .whereIn('name', [
      'email-verification',
      'password-reset',
      'portal-invitation',
      'tenant-recovery',
      'no-account-found',
      'ticket-assigned',
      'ticket-created',
      'ticket-updated',
      'ticket-closed',
      'ticket-comment-added',
      'invoice-generated',
      'payment-received',
      'payment-overdue'
    ])
    .del();

  console.log('German email templates removed');
};
