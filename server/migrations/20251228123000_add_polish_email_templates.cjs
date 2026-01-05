/**
 * Add Polish translations for client-facing email templates
 *
 * Translates authentication, ticketing, billing, and appointment email templates to Polish
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding Polish email templates...');

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
      'Payment Overdue',
      'appointment-request-received',
      'appointment-request-approved',
      'appointment-request-declined',
      'new-appointment-request',
      'survey-ticket-closed'
    ]);

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  // Insert Polish templates
  await knex('system_email_templates').insert([
    // Authentication templates
    // NOTE: email-verification template is managed in migration 20251029100000
    {
      name: 'password-reset',
      language_code: 'pl',
      subject: 'Prośba o zresetowanie hasła',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prośba o zresetowanie hasła</title>
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
    <h1>Prośba o zresetowanie hasła</h1>
    <p>Bezpieczne odzyskiwanie hasła do Twojego konta</p>
  </div>

  <div class="content">
    <h2>Cześć {{userName}},</h2>

    <p>Otrzymaliśmy prośbę o zresetowanie hasła dla konta powiązanego z <strong>{{email}}</strong>.</p>

    <div class="security-box">
      <h3>🔐 Weryfikacja bezpieczeństwa konta</h3>
      <p><strong>Zgłoszone:</strong> Przed chwilą</p>
      <p><strong>E-mail konta:</strong> {{email}}</p>
      <p><strong>Ważne przez:</strong> {{expirationTime}}</p>
    </div>

    <p>Aby ustawić nowe hasło, kliknij przycisk poniżej:</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Zresetuj hasło</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Lub skopiuj i wklej ten link w przeglądarce:
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Ważne informacje dotyczące bezpieczeństwa</h4>
      <ul>
        <li>Ten link resetujący wygaśnie za <strong>{{expirationTime}}</strong></li>
        <li>Ze względów bezpieczeństwa link może zostać użyty tylko <strong>raz</strong></li>
        <li>Jeśli nie prosiłeś(aś) o reset, zignoruj tę wiadomość</li>
        <li>Twoje hasło nie zmieni się, dopóki nie ustawisz nowego</li>
      </ul>
    </div>

    <h3>Co dalej?</h3>
    <ol>
      <li>Kliknij przycisk resetowania powyżej lub użyj podanego linku</li>
      <li>Utwórz silne i unikalne hasło do swojego konta</li>
      <li>Po resecie zostaniesz automatycznie zalogowany(a)</li>
      <li>Wszystkie bieżące sesje zostaną wylogowane ze względów bezpieczeństwa</li>
      <li>Rozważ włączenie uwierzytelniania dwuskładnikowego dla większej ochrony</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>Potrzebujesz pomocy?</h4>
      <p>Jeśli masz trudności z resetowaniem hasła, nasz zespół wsparcia jest do Twojej dyspozycji.</p>
      <p style="margin-top: 12px;"><strong>Skontaktuj się ze wsparciem:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>To automatyczna wiadomość bezpieczeństwa wysłana na {{email}}.</p>
    <p>Dla Twojego bezpieczeństwa nigdy nie wysyłamy haseł e-mailem.</p>
    <p>© {{currentYear}} {{clientName}}. Wszelkie prawa zastrzeżone.</p>
  </div>
</body>
</html>
      `,
      text_content: `Prośba o zresetowanie hasła

Cześć {{userName}},

Otrzymaliśmy prośbę o zresetowanie hasła dla konta powiązanego z {{email}}.

WERYFIKACJA BEZPIECZEŃSTWA KONTA
- Zgłoszone: Przed chwilą
- E-mail konta: {{email}}
- Ważne przez: {{expirationTime}}

Aby utworzyć nowe hasło, otwórz poniższy link:
{{resetLink}}

WAŻNE INFORMACJE DOTYCZĄCE BEZPIECZEŃSTWA:
- Link wygaśnie za {{expirationTime}}
- Może zostać użyty tylko raz
- Jeśli nie prosiłeś(aś) o reset, zignoruj tę wiadomość
- Twoje hasło nie zmieni się, dopóki nie ustawisz nowego

CO DALEJ:
1. Użyj powyższego linku
2. Utwórz silne i unikalne hasło
3. Zostaniesz automatycznie zalogowany(a)
4. Wszystkie istniejące sesje zostaną wylogowane
5. Rozważ włączenie uwierzytelniania dwuskładnikowego

Potrzebujesz pomocy?
Skontaktuj się ze wsparciem: {{supportEmail}}

---
To automatyczna wiadomość bezpieczeństwa wysłana na {{email}}.
© {{currentYear}} {{clientName}}. Wszelkie prawa zastrzeżone.`
    },
    // NOTE: portal-invitation template is managed in migration 20251029100000
    {
      name: 'tenant-recovery',
      language_code: 'pl',
      subject: '{{platformName}} - Twoje linki do logowania',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Cześć,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Poprosiłeś(aś) o dostęp do portalu{{#if isMultiple}}i{{/if}} klienta{{#if isMultiple}}ów{{/if}}.
              {{#if isMultiple}}Znaleźliśmy {{tenantCount}} organizacji powiązanych z Twoim adresem e-mail.{{else}}Oto Twój link do logowania:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Uwaga dotycząca bezpieczeństwa:</strong> Jeśli nie prosiłeś(aś) o te linki do logowania, możesz bezpiecznie zignorować tę wiadomość. Twoje konto pozostaje bezpieczne.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Jeśli masz pytania lub potrzebujesz pomocy, skontaktuj się z zespołem wsparcia swojej organizacji.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Wszelkie prawa zastrzeżone.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Twoje linki do logowania

Cześć,

Poprosiłeś(aś) o dostęp do portalu{{#if isMultiple}}i{{/if}} klienta{{#if isMultiple}}ów{{/if}}.
{{#if isMultiple}}Znaleźliśmy {{tenantCount}} organizacji powiązanych z Twoim adresem e-mail.{{else}}Oto Twój link do logowania:{{/if}}

Twoje linki do logowania:
{{tenantLinksText}}

Uwaga dotycząca bezpieczeństwa: Jeśli nie prosiłeś(aś) o te linki do logowania, możesz bezpiecznie zignorować tę wiadomość.

Jeśli masz pytania lub potrzebujesz pomocy, skontaktuj się z zespołem wsparcia swojej organizacji.

---
© {{currentYear}} {{platformName}}. Wszelkie prawa zastrzeżone.
To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.`
    },
    {
      name: 'no-account-found',
      language_code: 'pl',
      subject: '{{platformName}} - Prośba o dostęp',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Cześć,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Otrzymaliśmy prośbę o dostęp do portalu klienta z użyciem tego adresu e-mail.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Jeśli masz u nas konto, powinieneś/powinnaś otrzymać osobny e-mail z linkami do logowania.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Jeśli nie otrzymałeś(aś) e-maila z logowaniem, może to oznaczać:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Ten adres e-mail nie jest powiązany z żadnym kontem portalu klienta</li>
              <li>Twoje konto może być nieaktywne</li>
              <li>Wiadomość mogła trafić do folderu spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Potrzebujesz pomocy?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Jeśli uważasz, że powinieneś/powinnaś mieć dostęp do portalu klienta, skontaktuj się z zespołem wsparcia swojego dostawcy usług.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Uwaga dotycząca bezpieczeństwa:</strong> Jeśli nie prosiłeś(aś) o dostęp, możesz bezpiecznie zignorować tę wiadomość.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Wszelkie prawa zastrzeżone.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Prośba o dostęp

Cześć,

Otrzymaliśmy prośbę o dostęp do portalu klienta z użyciem tego adresu e-mail.

Jeśli masz u nas konto, powinieneś/powinnaś otrzymać osobny e-mail z linkami do logowania.

Jeśli nie otrzymałeś(aś) e-maila z logowaniem, może to oznaczać:
- Ten adres e-mail nie jest powiązany z żadnym kontem portalu klienta
- Twoje konto może być nieaktywne
- Wiadomość mogła trafić do folderu spam

Potrzebujesz pomocy?
Jeśli uważasz, że powinieneś/powinnaś mieć dostęp do portalu klienta, skontaktuj się z zespołem wsparcia swojego dostawcy usług.

Uwaga dotycząca bezpieczeństwa: Jeśli nie prosiłeś(aś) o dostęp, możesz bezpiecznie zignorować tę wiadomość.

---
© {{currentYear}} {{platformName}}. Wszelkie prawa zastrzeżone.
To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'pl',
      subject: 'Zgłoszenie przypisane • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Zgłoszenie przypisane</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">To zgłoszenie zostało do Ciebie przypisane dla <strong>{{ticket.clientName}}</strong>. Sprawdź szczegóły poniżej i podejmij odpowiednie działania.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Zgłoszenie #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorytet</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Przypisał(a)</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Przypisane do</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zgłaszający</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablica</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Lokalizacja</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Podsumowanie zgłoszenia</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.summary}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Zobacz zgłoszenie</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Zgłoszenie przypisane

To zgłoszenie zostało do Ciebie przypisane dla {{ticket.clientName}}.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
Priorytet: {{ticket.priority}}
Status: {{ticket.status}}
Przypisał(a): {{ticket.assignedBy}}
Przypisane do: {{ticket.assignedToName}} ({{ticket.assignedToEmail}})
Zgłaszający: {{ticket.requesterName}} ({{ticket.requesterContact}})
Tablica: {{ticket.board}}
Kategoria: {{ticket.categoryDetails}}
Lokalizacja: {{ticket.locationSummary}}

Podsumowanie:
{{ticket.summary}}

Zobacz zgłoszenie: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'pl',
      subject: 'Nowe zgłoszenie • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nowe zgłoszenie</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Utworzono nowe zgłoszenie dla <strong>{{ticket.clientName}}</strong>. Zapoznaj się z podsumowaniem i przejdź do zgłoszenia.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Zgłoszenie #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorytet</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Utworzono</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Przypisane do</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zgłaszający</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablica</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Lokalizacja</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Podsumowanie zgłoszenia</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.summary}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Zobacz zgłoszenie</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nowe zgłoszenie

Utworzono nowe zgłoszenie dla {{ticket.clientName}}.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
Priorytet: {{ticket.priority}}
Status: {{ticket.status}}
Utworzono: {{ticket.createdAt}} · {{ticket.createdBy}}
Przypisane do: {{ticket.assignedToName}} ({{ticket.assignedToEmail}})
Zgłaszający: {{ticket.requesterName}} ({{ticket.requesterContact}})
Tablica: {{ticket.board}}
Kategoria: {{ticket.categoryDetails}}
Lokalizacja: {{ticket.locationSummary}}

Podsumowanie:
{{ticket.summary}}

Zobacz zgłoszenie: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'pl',
      subject: 'Zgłoszenie zaktualizowane • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Zgłoszenie zaktualizowane</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało zaktualizowane. Sprawdź szczegóły i podejmij działania.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Zgłoszenie #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorytet</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zaktualizowano</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedAt}} · {{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Przypisane do</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zgłaszający</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablica</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Lokalizacja</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Podsumowanie zgłoszenia</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.summary}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Zobacz zgłoszenie</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Zgłoszenie zaktualizowane

Zgłoszenie dla {{ticket.clientName}} zostało zaktualizowane.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
Priorytet: {{ticket.priority}}
Status: {{ticket.status}}
Zaktualizowano: {{ticket.updatedAt}} · {{ticket.updatedBy}}
Przypisane do: {{ticket.assignedToName}} ({{ticket.assignedToEmail}})
Zgłaszający: {{ticket.requesterName}} ({{ticket.requesterContact}})
Tablica: {{ticket.board}}
Kategoria: {{ticket.categoryDetails}}
Lokalizacja: {{ticket.locationSummary}}

Podsumowanie:
{{ticket.summary}}

Zobacz zgłoszenie: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'pl',
      subject: 'Zgłoszenie zamknięte • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Zgłoszenie zamknięte</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało zamknięte. Poniżej znajdziesz podsumowanie.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Zamknięte</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorytet</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zamknięto</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedAt}} · {{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Przypisane do</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zgłaszający</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablica</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kategoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Lokalizacja</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Rozwiązanie</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Zobacz zgłoszenie</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Zgłoszenie zamknięte

Zgłoszenie dla {{ticket.clientName}} zostało zamknięte.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
Priorytet: {{ticket.priority}}
Status: {{ticket.status}}
Zamknięto: {{ticket.closedAt}} · {{ticket.closedBy}}
Przypisane do: {{ticket.assignedToName}} ({{ticket.assignedToEmail}})
Zgłaszający: {{ticket.requesterName}} ({{ticket.requesterContact}})
Tablica: {{ticket.board}}
Kategoria: {{ticket.categoryDetails}}
Lokalizacja: {{ticket.locationSummary}}

Rozwiązanie:
{{ticket.resolution}}

Zobacz zgłoszenie: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'pl',
      subject: 'Nowy komentarz • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nowy komentarz</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;"><strong>{{comment.authorName}}</strong> dodał(a) komentarz do zgłoszenia <strong>{{ticket.clientName}}</strong>.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Zgłoszenie #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorytet</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Zgłaszający</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                </table>
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Treść komentarza</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.body}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Zobacz zgłoszenie</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nowy komentarz

{{comment.authorName}} dodał(a) komentarz do zgłoszenia {{ticket.clientName}}.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
Priorytet: {{ticket.priority}}
Status: {{ticket.status}}
Zgłaszający: {{ticket.requesterName}} ({{ticket.requesterContact}})

Komentarz:
{{comment.body}}

Zobacz zgłoszenie: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'pl',
      subject: 'Nowa faktura • {{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nowa faktura</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">Faktura #{{invoice.number}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{invoice.clientName}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Nowa faktura została wystawiona. Sprawdź szczegóły poniżej.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Numer faktury</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.number}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kwota</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amount}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Data wystawienia</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.date}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Termin płatności</td>
                    <td style="padding:12px 0;">{{invoice.dueDate}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">Zobacz fakturę</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f5f3ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nowa faktura

Numer faktury: {{invoice.number}}
Kwota: {{invoice.amount}}
Data wystawienia: {{invoice.date}}
Termin płatności: {{invoice.dueDate}}

Zobacz fakturę: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'pl',
      subject: 'Płatność otrzymana • {{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Płatność otrzymana</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">Faktura #{{invoice.number}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{invoice.clientName}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Otrzymaliśmy płatność za fakturę. Dziękujemy!</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Numer faktury</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.number}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kwota</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amount}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Data płatności</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.paymentDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Metoda płatności</td>
                    <td style="padding:12px 0;">{{invoice.paymentMethod}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">Zobacz fakturę</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Płatność otrzymana

Numer faktury: {{invoice.number}}
Kwota: {{invoice.amount}}
Data płatności: {{invoice.paymentDate}}
Metoda płatności: {{invoice.paymentMethod}}

Zobacz fakturę: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'pl',
      subject: 'Płatność po terminie • {{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Płatność po terminie</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">Faktura #{{invoice.number}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{invoice.clientName}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Płatność za poniższą fakturę jest po terminie. Prosimy o uregulowanie należności.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Numer faktury</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.number}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Kwota do zapłaty</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amountDue}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Termin płatności</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.dueDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Dni po terminie</td>
                    <td style="padding:12px 0;">{{invoice.daysOverdue}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">Zobacz fakturę</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#fef2f2;color:#dc2626;font-size:12px;text-align:center;">Powered by Alga PSA</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Płatność po terminie

Numer faktury: {{invoice.number}}
Kwota do zapłaty: {{invoice.amountDue}}
Termin płatności: {{invoice.dueDate}}
Dni po terminie: {{invoice.daysOverdue}}

Zobacz fakturę: {{invoice.url}}
      `
    },

    // Portal Invitation
    {
      name: 'portal-invitation',
      language_code: 'pl',
      subject: 'Zaproszenie do portalu klienta{{#if clientName}} - {{clientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zaproszenie do portalu</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .header { background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%); color: white; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .header p { margin: 0; opacity: 1; font-size: 16px; color: rgba(255, 255, 255, 0.95); }
    .content { background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-bottom: none; }
    .footer { background: #1e293b; color: #cbd5e1; padding: 24px; border-radius: 0 0 12px 12px; text-align: center; font-size: 14px; }
    .footer p { margin: 6px 0; color: #cbd5e1; }
    .info-box { background: #faf8ff; padding: 24px; border-radius: 8px; border: 1px solid #e9e5f5; border-left: 4px solid #8a4dea; margin: 24px 0; }
    .info-box h3 { color: #0f172a; margin: 0 0 16px 0; font-size: 18px; font-weight: 600; }
    .info-box p { margin: 8px 0; color: #475569; font-size: 15px; }
    .action-button { display: inline-block; background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .warning { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 24px 0; }
    .warning h4 { color: #b45309; margin: 0 0 8px 0; font-size: 15px; }
    .warning p { color: #92400e; margin: 0; font-size: 14px; }
    .link-text { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #475569; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Witamy w portalu klienta</h1>
    <p>Twój dostęp do zarządzania usługami jest gotowy</p>
  </div>
  <div class="content">
    <h2>Witaj {{contactName}},</h2>
    <p>Zostałeś(aś) zaproszony(a) do portalu klienta {{clientName}}. Ten bezpieczny portal daje Ci natychmiastowy dostęp do:</p>
    <div class="info-box">
      <h3>Twój dostęp obejmuje:</h3>
      <p>✓ Przeglądanie i śledzenie Twoich zgłoszeń serwisowych</p>
      <p>✓ Przegląd aktualizacji projektów i dokumentacji</p>
      <p>✓ Bezpośrednia komunikacja z zespołem wsparcia</p>
    </div>
    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Skonfiguruj dostęp do portalu</a>
    </div>
    <p style="text-align: center; color: #64748b; font-size: 14px;">Lub skopiuj i wklej ten link do przeglądarki:</p>
    <div class="link-text">{{portalLink}}</div>
    <div class="warning">
      <h4>⏰ Zaproszenie ograniczone czasowo</h4>
      <p>Ten link zaproszeniowy wygaśnie za {{expirationTime}}. Dokończ konfigurację konta przed tym terminem, aby zapewnić nieprzerwany dostęp.</p>
    </div>
    <div class="contact-info">
      <h4>Potrzebujesz pomocy?</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>Telefon:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Nasz zespół wsparcia jest gotowy, aby pomóc Ci rozpocząć.</p>
    </div>
  </div>
  <div class="footer">
    <p>Ta wiadomość została wysłana do {{contactName}} w ramach konfiguracji dostępu do portalu.</p>
    <p>Jeśli nie spodziewałeś(aś) się tego zaproszenia, skontaktuj się z nami pod adresem {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. Wszelkie prawa zastrzeżone.</p>
  </div>
</body>
</html>`,
      text_content: `Witamy w portalu klienta

Witaj {{contactName}},

Zostałeś(aś) zaproszony(a) do portalu klienta {{clientName}}. Ten bezpieczny portal daje Ci natychmiastowy dostęp do:

✓ Przeglądanie i śledzenie Twoich zgłoszeń serwisowych
✓ Przegląd aktualizacji projektów i dokumentacji
✓ Bezpośrednia komunikacja z zespołem wsparcia

Skonfiguruj dostęp do portalu: {{portalLink}}

⏰ Zaproszenie ograniczone czasowo
Ten link zaproszeniowy wygaśnie za {{expirationTime}}. Dokończ konfigurację konta przed tym terminem, aby zapewnić nieprzerwany dostęp.

Potrzebujesz pomocy?
Email: {{clientLocationEmail}}
Telefon: {{clientLocationPhone}}
Nasz zespół wsparcia jest gotowy, aby pomóc Ci rozpocząć.

---
Ta wiadomość została wysłana do {{contactName}} w ramach konfiguracji dostępu do portalu.
Jeśli nie spodziewałeś(aś) się tego zaproszenia, skontaktuj się z nami pod adresem {{clientLocationEmail}}.
© {{currentYear}} {{clientName}}. Wszelkie prawa zastrzeżone.`
    },

    // Email Verification
    {
      name: 'email-verification',
      language_code: 'pl',
      subject: 'Zweryfikuj swój adres email{{#if registrationClientName}} dla {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weryfikacja adresu email</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-bottom: none; }
    .footer { background: #1e293b; color: #cbd5e1; padding: 24px; border-radius: 0 0 12px 12px; text-align: center; font-size: 14px; }
    .action-button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .warning { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 24px 0; }
    .link-text { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #475569; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Zweryfikuj swój adres email</h1>
    <p>Jeszcze jeden krok do ukończenia rejestracji</p>
  </div>
  <div class="content">
    <h2>Witaj{{#if contactName}} {{contactName}}{{/if}},</h2>
    <p>Dziękujemy za rejestrację! Proszę zweryfikować swój adres email, klikając poniższy przycisk:</p>
    <div style="text-align: center;">
      <a href="{{verificationLink}}" class="action-button">Zweryfikuj adres email</a>
    </div>
    <p style="text-align: center; color: #64748b; font-size: 14px;">Lub skopiuj i wklej ten link do przeglądarki:</p>
    <div class="link-text">{{verificationLink}}</div>
    <div class="warning">
      <h4>⏰ Link ograniczony czasowo</h4>
      <p>Ten link weryfikacyjny wygaśnie za {{expirationTime}}. Jeśli link wygaśnie, możesz poprosić o nowy na stronie logowania.</p>
    </div>
    <p style="color: #64748b; font-size: 14px;">Jeśli nie zakładałeś(aś) konta, możesz bezpiecznie zignorować tę wiadomość.</p>
  </div>
  <div class="footer">
    <p>Ta wiadomość została wysłana automatycznie. Prosimy nie odpowiadać na nią.</p>
  </div>
</body>
</html>`,
      text_content: `Zweryfikuj swój adres email

Witaj{{#if contactName}} {{contactName}}{{/if}},

Dziękujemy za rejestrację! Proszę zweryfikować swój adres email, klikając poniższy link:

{{verificationLink}}

⏰ Link ograniczony czasowo
Ten link weryfikacyjny wygaśnie za {{expirationTime}}. Jeśli link wygaśnie, możesz poprosić o nowy na stronie logowania.

Jeśli nie zakładałeś(aś) konta, możesz bezpiecznie zignorować tę wiadomość.`
    },

    // Appointment Request Received
    {
      name: 'appointment-request-received',
      language_code: 'pl',
      subject: 'Wniosek o wizytę otrzymany - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Wniosek otrzymany</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .details-box { background-color: #f8fafc; border-left: 4px solid #8a4dea; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .reference-number { background-color: #ede9fe; color: #6d28d9; padding: 8px 16px; border-radius: 6px; font-weight: 600; display: inline-block; margin: 16px 0; }
    .info-box { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Wniosek otrzymany</h1>
      <p>Otrzymaliśmy Twój wniosek o wizytę</p>
    </div>
    <div class="content">
      <p>Witaj{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p>Dziękujemy za złożenie wniosku o wizytę. Otrzymaliśmy Twój wniosek i nasz zespół wkrótce go rozpatrzy.</p>
      <div class="reference-number">Numer referencyjny: {{referenceNumber}}</div>
      <div class="details-box">
        <h3>Szczegóły wniosku</h3>
        <p><strong>Usługa:</strong> {{serviceName}}</p>
        <p><strong>Żądana data:</strong> {{requestedDate}}</p>
        <p><strong>Żądana godzina:</strong> {{requestedTime}}</p>
        <p><strong>Czas trwania:</strong> {{duration}} minut</p>
        {{#if preferredTechnician}}<p><strong>Preferowany technik:</strong> {{preferredTechnician}}</p>{{/if}}
      </div>
      <div class="info-box">
        <p><strong>Co dalej?</strong></p>
        <p>Nasz zespół rozpatrzy Twój wniosek i potwierdzi dostępność. Otrzymasz powiadomienie email, gdy wizyta zostanie zatwierdzona lub jeśli będą potrzebne zmiany. Zazwyczaj odpowiadamy w ciągu {{responseTime}}.</p>
      </div>
      <p>Jeśli masz pytania lub chcesz wprowadzić zmiany do wniosku, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.</p>
    </div>
  </div>
</body>
</html>`,
      text_content: `Wniosek o wizytę otrzymany

Witaj{{#if requesterName}} {{requesterName}}{{/if}},

Dziękujemy za złożenie wniosku o wizytę. Otrzymaliśmy Twój wniosek i nasz zespół wkrótce go rozpatrzy.

Numer referencyjny: {{referenceNumber}}

SZCZEGÓŁY WNIOSKU:
Usługa: {{serviceName}}
Żądana data: {{requestedDate}}
Żądana godzina: {{requestedTime}}
Czas trwania: {{duration}} minut
{{#if preferredTechnician}}Preferowany technik: {{preferredTechnician}}{{/if}}

CO DALEJ?
Nasz zespół rozpatrzy Twój wniosek i potwierdzi dostępność. Otrzymasz powiadomienie email, gdy wizyta zostanie zatwierdzona lub jeśli będą potrzebne zmiany. Zazwyczaj odpowiadamy w ciągu {{responseTime}}.

Jeśli masz pytania lub chcesz wprowadzić zmiany do wniosku, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.`
    },

    // Appointment Request Approved
    {
      name: 'appointment-request-approved',
      language_code: 'pl',
      subject: 'Wizyta potwierdzona - {{serviceName}} dnia {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Wizyta potwierdzona</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .details-box { background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .technician-box { background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✓ Wizyta potwierdzona</h1>
      <p>Twój wniosek o wizytę został zatwierdzony</p>
    </div>
    <div class="content">
      <p>Witaj{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p>Świetna wiadomość! Twój wniosek o wizytę został zatwierdzony i zaplanowany.</p>
      <div class="details-box">
        <h3>Szczegóły wizyty</h3>
        <p><strong>Usługa:</strong> {{serviceName}}</p>
        <p><strong>Data:</strong> {{appointmentDate}}</p>
        <p><strong>Godzina:</strong> {{appointmentTime}}</p>
        <p><strong>Czas trwania:</strong> {{duration}} minut</p>
        {{#if location}}<p><strong>Lokalizacja:</strong> {{location}}</p>{{/if}}
      </div>
      {{#if technicianName}}
      <div class="technician-box">
        <h4>Twój przypisany technik</h4>
        <p><strong>{{technicianName}}</strong></p>
        {{#if technicianEmail}}<p>{{technicianEmail}}</p>{{/if}}
        {{#if technicianPhone}}<p>{{technicianPhone}}</p>{{/if}}
      </div>
      {{/if}}
      <p>Jeśli potrzebujesz przełożyć lub anulować wizytę, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.</p>
    </div>
  </div>
</body>
</html>`,
      text_content: `Wizyta potwierdzona

Witaj{{#if requesterName}} {{requesterName}}{{/if}},

Świetna wiadomość! Twój wniosek o wizytę został zatwierdzony i zaplanowany.

SZCZEGÓŁY WIZYTY:
Usługa: {{serviceName}}
Data: {{appointmentDate}}
Godzina: {{appointmentTime}}
Czas trwania: {{duration}} minut
{{#if location}}Lokalizacja: {{location}}{{/if}}

{{#if technicianName}}
TWÓJ PRZYPISANY TECHNIK:
{{technicianName}}
{{#if technicianEmail}}{{technicianEmail}}{{/if}}
{{#if technicianPhone}}{{technicianPhone}}{{/if}}
{{/if}}

Jeśli potrzebujesz przełożyć lub anulować wizytę, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.`
    },

    // Appointment Request Declined
    {
      name: 'appointment-request-declined',
      language_code: 'pl',
      subject: 'Aktualizacja wniosku o wizytę - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aktualizacja wniosku</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .reason-box { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 6px; }
    .help-box { background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Aktualizacja wniosku o wizytę</h1>
      <p>Ważne informacje o Twoim wniosku</p>
    </div>
    <div class="content">
      <p>Witaj{{#if requesterName}} {{requesterName}}{{/if}},</p>
      <p>Dziękujemy za zainteresowanie umówieniem wizyty u nas. Niestety, nie możemy zrealizować Twojego wniosku w żądanym terminie.</p>
      {{#if declineReason}}
      <div class="reason-box">
        <h4>Powód:</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}
      <div class="help-box">
        <h4>Chętnie pomożemy</h4>
        <p>Przepraszamy za niedogodności. Zachęcamy do złożenia nowego wniosku na inny termin.</p>
      </div>
      <p>Jeśli masz pytania lub potrzebujesz pomocy w znalezieniu dostępnego terminu, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.</p>
    </div>
  </div>
</body>
</html>`,
      text_content: `Aktualizacja wniosku o wizytę

Witaj{{#if requesterName}} {{requesterName}}{{/if}},

Dziękujemy za zainteresowanie umówieniem wizyty u nas. Niestety, nie możemy zrealizować Twojego wniosku w żądanym terminie.

{{#if declineReason}}
POWÓD:
{{declineReason}}
{{/if}}

CHĘTNIE POMOŻEMY
Przepraszamy za niedogodności. Zachęcamy do złożenia nowego wniosku na inny termin.

Jeśli masz pytania lub potrzebujesz pomocy w znalezieniu dostępnego terminu, skontaktuj się z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwoń pod {{contactPhone}}{{/if}}.`
    },

    // New Appointment Request (for MSP staff)
    {
      name: 'new-appointment-request',
      language_code: 'pl',
      subject: 'Nowy wniosek o wizytę - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nowy wniosek o wizytę</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .container { background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: linear-gradient(135deg, #8A4DEA, #40CFF9); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { padding: 32px 24px; }
    .request-details { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Nowy wniosek o wizytę</h1>
      <p>Wymagana akcja</p>
    </div>
    <div class="content">
      <p>Zespole,</p>
      <p>Wpłynął nowy wniosek o wizytę wymagający przeglądu i zatwierdzenia.</p>
      <div class="request-details">
        <h3>Szczegóły wizyty</h3>
        <p><strong>Usługa:</strong> {{serviceName}}</p>
        <p><strong>Żądana data:</strong> {{requestedDate}}</p>
        <p><strong>Żądana godzina:</strong> {{requestedTime}}</p>
        <p><strong>Czas trwania:</strong> {{duration}} minut</p>
      </div>
      <p>Proszę przejrzeć ten wniosek i podjąć odpowiednie działania. Wnioskodawca czeka na potwierdzenie.</p>
    </div>
  </div>
</body>
</html>`,
      text_content: `Nowy wniosek o wizytę - Wymagana akcja

Zespole,

Wpłynął nowy wniosek o wizytę wymagający przeglądu i zatwierdzenia.

INFORMACJE O WNIOSKODAWCY:
Imię: {{requesterName}}
Email: {{requesterEmail}}
{{#if requesterPhone}}Telefon: {{requesterPhone}}{{/if}}
{{#if clientName}}Klient: {{clientName}}{{/if}}

SZCZEGÓŁY WIZYTY:
Usługa: {{serviceName}}
Żądana data: {{requestedDate}}
Żądana godzina: {{requestedTime}}
Czas trwania: {{duration}} minut

Proszę przejrzeć ten wniosek i podjąć odpowiednie działania.`
    },

    // Survey - Ticket Closed
    {
      name: 'SURVEY_TICKET_CLOSED',
      language_code: 'pl',
      subject: 'Chętnie poznamy Twoją opinię o zgłoszeniu {{ticket_number}}',
      notification_subtype_id: getSubtypeId('survey-ticket-closed'),
      html_content: `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chętnie poznamy Twoją opinię o zgłoszeniu {{ticket_number}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;font-weight:600;">Chętnie poznamy Twoją opinię o zgłoszeniu {{ticket_number}}</h1>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">Zgłoszenie #{{ticket_number}} · {{ticket_subject}}</p>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">Technik: {{technician_name}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:16px;">Cześć {{contact_name}},</p>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">{{prompt_text}}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#475569;">Wybierz ocenę poniżej, aby dać nam znać, jak nam poszło:</p>
              <div style="text-align:center;margin:24px 0;">
                {{rating_buttons_html}}
              </div>
              <div style="background-color:#f1f5f9;border-radius:10px;padding:16px 20px;margin:24px 0;">
                <p style="margin:0;font-size:14px;color:#475569;">Jeśli przyciski się nie załadują, otwórz ten bezpieczny link do ankiety:</p>
                <p style="margin:12px 0 0 0;font-size:14px;color:#2563eb;word-break:break-all;">
                  <a href="{{survey_url}}" style="color:#2563eb;text-decoration:none;">{{survey_url}}</a>
                </p>
              </div>
              <p style="margin:0 0 20px 0;font-size:14px;color:#475569;white-space:pre-line;">{{rating_links_text}}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;">{{thank_you_text}}</p>
              <p style="margin:20px 0 0 0;font-size:12px;color:#94a3b8;">
                {{tenant_name}} · Zgłoszenie #{{ticket_number}} · {{ticket_closed_at}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      text_content: `Chętnie poznamy Twoją opinię o zgłoszeniu {{ticket_number}}

Cześć {{contact_name}},
Zgłoszenie #{{ticket_number}} · {{ticket_subject}}
Technik: {{technician_name}}

{{prompt_text}}
Wybierz ocenę poniżej, aby dać nam znać, jak nam poszło:

Jeśli przyciski się nie załadują, otwórz ten bezpieczny link do ankiety:
{{rating_links_text}}

{{thank_you_text}}

{{tenant_name}} · Zgłoszenie #{{ticket_number}} · {{ticket_closed_at}}`
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ Polish email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove Polish email templates
  await knex('system_email_templates')
    .where({ language_code: 'pl' })
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
      'payment-overdue',
      'portal-invitation',
      'email-verification',
      'appointment-request-received',
      'appointment-request-approved',
      'appointment-request-declined',
      'new-appointment-request',
      'SURVEY_TICKET_CLOSED'
    ])
    .del();

  console.log('Polish email templates removed');
};
