/**
 * Add Dutch translations for client-facing email templates
 *
 * Translates authentication, ticketing, and billing email templates to Dutch
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding Dutch email templates...');

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

  // Insert Dutch templates
  await knex('system_email_templates').insert([
    // Authentication templates
    // NOTE: email-verification template is managed in migration 20251029100000
    {
      name: 'password-reset',
      language_code: 'nl',
      subject: 'Verzoek tot Wachtwoordherstel',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verzoek tot Wachtwoordherstel</title>
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
    <h1>Verzoek tot Wachtwoordherstel</h1>
    <p>Veilige wachtwoordherstel voor uw account</p>
  </div>

  <div class="content">
    <h2>Hallo {{userName}},</h2>

    <p>We hebben een verzoek ontvangen om het wachtwoord voor uw account gekoppeld aan <strong>{{email}}</strong> opnieuw in te stellen.</p>

    <div class="security-box">
      <h3>🔐 Beveiligingscontrole Account</h3>
      <p><strong>Aangevraagd:</strong> Zojuist</p>
      <p><strong>Account e-mail:</strong> {{email}}</p>
      <p><strong>Geldig voor:</strong> {{expirationTime}}</p>
    </div>

    <p>Om een nieuw wachtwoord voor uw account aan te maken, klikt u op de knop hieronder:</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Wachtwoord Opnieuw Instellen</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Of kopieer deze link naar uw browser:
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Belangrijke Beveiligingsinformatie</h4>
      <ul>
        <li>Deze wachtwoordherstellink verloopt over <strong>{{expirationTime}}</strong></li>
        <li>Om beveiligingsredenen kan deze link slechts <strong>één keer</strong> worden gebruikt</li>
        <li>Als u dit herstel niet heeft aangevraagd, kunt u deze e-mail negeren</li>
        <li>Uw wachtwoord verandert pas als u een nieuw wachtwoord aanmaakt</li>
      </ul>
    </div>

    <h3>Wat Nu?</h3>
    <ol>
      <li>Klik op de herstelknop hierboven of gebruik de verstrekte link</li>
      <li>Maak een sterk, uniek wachtwoord voor uw account</li>
      <li>U wordt automatisch ingelogd na het opnieuw instellen</li>
      <li>Alle bestaande sessies worden beëindigd voor de beveiliging</li>
      <li>Overweeg tweefactorauthenticatie in te schakelen voor extra bescherming</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>Hulp Nodig?</h4>
      <p>Als u problemen ondervindt bij het opnieuw instellen van uw wachtwoord, staat ons ondersteuningsteam voor u klaar.</p>
      <p style="margin-top: 12px;"><strong>Contact Ondersteuning:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>Dit is een geautomatiseerde beveiligingse-mail verzonden naar {{email}}.</p>
    <p>Voor uw veiligheid vermelden we nooit wachtwoorden in e-mails.</p>
    <p>© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.</p>
  </div>
</body>
</html>
      `,
      text_content: `Verzoek tot Wachtwoordherstel

Hallo {{userName}},

We hebben een verzoek ontvangen om het wachtwoord voor uw account gekoppeld aan {{email}} opnieuw in te stellen.

BEVEILIGINGSCONTROLE ACCOUNT
- Aangevraagd: Zojuist
- Account e-mail: {{email}}
- Geldig voor: {{expirationTime}}

Om een nieuw wachtwoord aan te maken, bezoekt u de volgende link:
{{resetLink}}

BELANGRIJKE BEVEILIGINGSINFORMATIE:
- Deze link verloopt over {{expirationTime}}
- Kan slechts één keer worden gebruikt
- Als u dit niet heeft aangevraagd, negeer deze e-mail
- Uw wachtwoord verandert pas als u een nieuw wachtwoord aanmaakt

WAT NU:
1. Gebruik de verstrekte link hierboven
2. Maak een sterk, uniek wachtwoord
3. U wordt automatisch ingelogd
4. Alle bestaande sessies worden beëindigd
5. Overweeg tweefactorauthenticatie in te schakelen

Hulp nodig?
Contact Ondersteuning: {{supportEmail}}

---
Dit is een geautomatiseerde beveiligingse-mail verzonden naar {{email}}.
© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.`
    },
    // NOTE: portal-invitation template is managed in migration 20251029100000
    {
      name: 'tenant-recovery',
      language_code: 'nl',
      subject: '{{platformName}} - Uw inloglinks',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
              {{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren. Uw account blijft beveiligd.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Uw inloglinks

Hallo,

U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
{{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}

Uw inloglinks:
{{tenantLinksText}}

Beveiligingsopmerking: Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren.

Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.

---
© {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`
    },
    {
      name: 'no-account-found',
      language_code: 'nl',
      subject: '{{platformName}} - Toegangsverzoek',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Dit e-mailadres is niet gekoppeld aan een klantenportalaccount</li>
              <li>Uw account kan inactief zijn</li>
              <li>De e-mail kan zijn gefilterd naar uw spam-map</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Hulp nodig?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Toegangsverzoek

Hallo,

We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.

Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.

Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
- Dit e-mailadres is niet gekoppeld aan een klantenportalaccount
- Uw account kan inactief zijn
- De e-mail kan zijn gefilterd naar uw spam-map

Hulp nodig?
Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.

Beveiligingsopmerking: Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.

---
© {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'nl',
      subject: 'Ticket Toegewezen • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Toegewezen</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Dit ticket is aan u toegewezen voor <strong>{{ticket.clientName}}</strong>. Bekijk de details hieronder en onderneem actie.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioriteit</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen door</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen aan</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aanvrager</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bord</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Locatie</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Beschrijving</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Bekijken</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams op één lijn houden</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Toegewezen aan U

{{ticket.metaLine}}
Toegewezen door: {{ticket.assignedBy}}

Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}
Toegewezen aan: {{ticket.assignedDetails}}
Aanvrager: {{ticket.requesterDetails}}
Bord: {{ticket.board}}
Categorie: {{ticket.categoryDetails}}
Locatie: {{ticket.locationSummary}}

Beschrijving:
{{ticket.description}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'nl',
      subject: 'Nieuw Ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nieuw Ticket Aangemaakt</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Een nieuw ticket is geregistreerd voor <strong>{{ticket.clientName}}</strong>. Bekijk de samenvatting hieronder en volg de link om actie te ondernemen.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioriteit</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aangemaakt</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen aan</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aanvrager</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bord</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Locatie</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Beschrijving</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Bekijken</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams op één lijn houden</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nieuw Ticket Aangemaakt voor {{ticket.clientName}}

{{ticket.metaLine}}
Aangemaakt: {{ticket.createdAt}} · {{ticket.createdBy}}

Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}
Toegewezen aan: {{ticket.assignedDetails}}
Aanvrager: {{ticket.requesterDetails}}
Bord: {{ticket.board}}
Categorie: {{ticket.categoryDetails}}
Locatie: {{ticket.locationSummary}}

Beschrijving:
{{ticket.description}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'nl',
      subject: 'Ticket Bijgewerkt • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Bijgewerkt</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Een ticket is bijgewerkt voor <strong>{{ticket.clientName}}</strong>. Bekijk de wijzigingen hieronder.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioriteit</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bijgewerkt door</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen aan</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aanvrager</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bord</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Locatie</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Wijzigingen</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Bekijken</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams op één lijn houden</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Bijgewerkt

{{ticket.metaLine}}
Bijgewerkt door: {{ticket.updatedBy}}

Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}
Toegewezen aan: {{ticket.assignedDetails}}
Aanvrager: {{ticket.requesterDetails}}
Bord: {{ticket.board}}
Categorie: {{ticket.categoryDetails}}
Locatie: {{ticket.locationSummary}}

Wijzigingen:
{{ticket.changes}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'nl',
      subject: 'Ticket Gesloten • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Gesloten</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Een ticket is opgelost en gesloten voor <strong>{{ticket.clientName}}</strong>. Bekijk de oplossingsdetails hieronder.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Gesloten</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Gesloten door</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen aan</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aanvrager</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bord</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Locatie</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Oplossing</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Bekijken</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Teams op één lijn houden</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Gesloten

{{ticket.metaLine}}
Gesloten door: {{ticket.closedBy}}

Status: Gesloten
Toegewezen aan: {{ticket.assignedDetails}}
Aanvrager: {{ticket.requesterDetails}}
Bord: {{ticket.board}}
Categorie: {{ticket.categoryDetails}}
Locatie: {{ticket.locationSummary}}

Oplossing:
{{ticket.resolution}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'nl',
      subject: 'Nieuwe Opmerking • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nieuwe Opmerking Toegevoegd</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Een nieuwe opmerking is toegevoegd aan een ticket voor <strong>{{ticket.clientName}}</strong>.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioriteit</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Opmerking van</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Toegewezen aan</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aanvrager</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Bord</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Locatie</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Opmerking</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ticket Bekijken</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Teams op één lijn houden</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nieuwe Opmerking Toegevoegd

{{ticket.metaLine}}
Opmerking van: {{comment.author}}

Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}
Toegewezen aan: {{ticket.assignedDetails}}
Aanvrager: {{ticket.requesterDetails}}
Bord: {{ticket.board}}
Categorie: {{ticket.categoryDetails}}
Locatie: {{ticket.locationSummary}}

Opmerking:
{{comment.content}}

Ticket bekijken: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'nl',
      subject: 'Nieuwe factuur #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Factuur {{invoice.number}}</h2>
        <p>Een nieuwe factuur is aangemaakt voor uw controle:</p>
        <div class="details">
          <p><strong>Factuurnummer:</strong> {{invoice.number}}</p>
          <p><strong>Bedrag:</strong> {{invoice.amount}}</p>
          <p><strong>Vervaldatum:</strong> {{invoice.dueDate}}</p>
          <p><strong>Klant:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Factuur bekijken</a>
      `,
      text_content: `
Factuur {{invoice.number}}

Een nieuwe factuur is aangemaakt voor uw controle:

Factuurnummer: {{invoice.number}}
Bedrag: {{invoice.amount}}
Vervaldatum: {{invoice.dueDate}}
Klant: {{invoice.clientName}}

Factuur bekijken: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'nl',
      subject: 'Betaling ontvangen: Factuur #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Betaling ontvangen</h2>
        <p>Betaling is ontvangen voor factuur #{{invoice.number}}:</p>
        <div class="details">
          <p><strong>Factuurnummer:</strong> {{invoice.number}}</p>
          <p><strong>Betaald bedrag:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Betaaldatum:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Betaalmethode:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Factuur bekijken</a>
      `,
      text_content: `
Betaling ontvangen

Betaling is ontvangen voor factuur #{{invoice.number}}:

Factuurnummer: {{invoice.number}}
Betaald bedrag: {{invoice.amountPaid}}
Betaaldatum: {{invoice.paymentDate}}
Betaalmethode: {{invoice.paymentMethod}}

Factuur bekijken: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'nl',
      subject: 'Betaling achterstallig: Factuur #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Betaling achterstallig</h2>
        <p>De betaling voor factuur #{{invoice.number}} is achterstallig:</p>
        <div class="details">
          <p><strong>Factuurnummer:</strong> {{invoice.number}}</p>
          <p><strong>Verschuldigd bedrag:</strong> {{invoice.amountDue}}</p>
          <p><strong>Vervaldatum:</strong> {{invoice.dueDate}}</p>
          <p><strong>Dagen achterstallig:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Factuur bekijken</a>
      `,
      text_content: `
Betaling achterstallig

De betaling voor factuur #{{invoice.number}} is achterstallig:

Factuurnummer: {{invoice.number}}
Verschuldigd bedrag: {{invoice.amountDue}}
Vervaldatum: {{invoice.dueDate}}
Dagen achterstallig: {{invoice.daysOverdue}}

Factuur bekijken: {{invoice.url}}
      `
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ Dutch email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove Dutch email templates
  // NOTE: email-verification and portal-invitation are NOT removed as they're managed by migration 20251029100000
  await knex('system_email_templates')
    .where({ language_code: 'nl' })
    .whereIn('name', [
      'password-reset',
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

  console.log('Dutch email templates removed');
};
