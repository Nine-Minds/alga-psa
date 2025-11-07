/**
 * Add Italian translations for client-facing email templates
 *
 * Translates authentication, ticketing, and billing email templates to Italian
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding Italian email templates...');

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

  // Insert Italian templates
  await knex('system_email_templates').insert([
    // Authentication templates
    // NOTE: email-verification template is managed in migration 20251029100000
    {
      name: 'password-reset',
      language_code: 'it',
      subject: 'Richiesta di reimpostazione della password',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Richiesta di reimpostazione della password</title>
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
    <h1>Richiesta di reimpostazione della password</h1>
    <p>Ripristino sicuro della password del tuo account</p>
  </div>

  <div class="content">
    <h2>Ciao {{userName}},</h2>

    <p>Abbiamo ricevuto una richiesta di reimpostazione della password per l'account associato a <strong>{{email}}</strong>.</p>

    <div class="security-box">
      <h3>🔐 Verifica di sicurezza dell'account</h3>
      <p><strong>Richiesta:</strong> Poco fa</p>
      <p><strong>Email dell'account:</strong> {{email}}</p>
      <p><strong>Valido per:</strong> {{expirationTime}}</p>
    </div>

    <p>Per creare una nuova password per il tuo account, fai clic sul pulsante qui sotto:</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Reimposta password</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Oppure copia e incolla questo link nel tuo browser:
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Informazioni di sicurezza importanti</h4>
      <ul>
        <li>Questo link di reimpostazione scadrà tra <strong>{{expirationTime}}</strong></li>
        <li>Per motivi di sicurezza questo link può essere utilizzato <strong>una sola volta</strong></li>
        <li>Se non hai richiesto questo ripristino, ignora questa email</li>
        <li>La tua password non verrà modificata finché non ne imposterai una nuova</li>
      </ul>
    </div>

    <h3>Cosa succede adesso?</h3>
    <ol>
      <li>Fai clic sul pulsante di reimpostazione oppure usa il link fornito</li>
      <li>Crea una password sicura e unica per il tuo account</li>
      <li>Verrai autenticato automaticamente dopo il ripristino</li>
      <li>Tutte le sessioni esistenti verranno chiuse per sicurezza</li>
      <li>Valuta l'attivazione dell'autenticazione a due fattori per maggiore protezione</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>Hai bisogno di aiuto?</h4>
      <p>Se riscontri problemi nel reimpostare la password, il nostro team di supporto è a tua disposizione.</p>
      <p style="margin-top: 12px;"><strong>Contatta il supporto:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>Questa è un'email di sicurezza automatica inviata a {{email}}.</p>
    <p>Per la tua sicurezza non includiamo mai password nelle email.</p>
    <p>© {{currentYear}} {{clientName}}. Tutti i diritti riservati.</p>
  </div>
</body>
</html>
      `,
      text_content: `Richiesta di reimpostazione della password

Ciao {{userName}},

Abbiamo ricevuto una richiesta di reimpostazione della password per l'account associato a {{email}}.

VERIFICA DI SICUREZZA DELL'ACCOUNT
- Richiesta: Poco fa
- Email dell'account: {{email}}
- Valido per: {{expirationTime}}

Per creare una nuova password, visita il seguente link:
{{resetLink}}

INFORMAZIONI IMPORTANTI:
- Questo link scadrà tra {{expirationTime}}
- Può essere utilizzato una sola volta
- Se non hai richiesto questa operazione, ignora questa email
- La tua password non verrà modificata finché non ne imposterai una nuova

Cosa succede adesso?
1. Usa il link fornito qui sopra
2. Crea una password sicura e unica
3. Verrai autenticato automaticamente
4. Tutte le sessioni esistenti verranno chiuse
5. Valuta l'autenticazione a due fattori

Hai bisogno di aiuto?
Contatta il supporto: {{supportEmail}}

---
Questa è un'email di sicurezza automatica inviata a {{email}}.
© {{currentYear}} {{clientName}}. Tutti i diritti riservati.`
    },
    // NOTE: portal-invitation template is managed in migration 20251029100000
    {
      name: 'tenant-recovery',
      language_code: 'it',
      subject: '{{platformName}} - I tuoi link di accesso',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Ciao,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Hai richiesto l'accesso al tuo{{#if isMultiple}}i{{/if}} portale{{#if isMultiple}}i{{/if}} clienti.
              {{#if isMultiple}}Abbiamo trovato {{tenantCount}} organizzazioni associate al tuo indirizzo email.{{else}}Ecco il tuo link di accesso:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota di sicurezza:</strong> Se non hai richiesto questi link di accesso, puoi ignorare questa email in tutta sicurezza. Il tuo account rimane protetto.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Se hai domande o hai bisogno di assistenza, contatta il team di supporto della tua organizzazione.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tutti i diritti riservati.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Questo è un messaggio automatico. Non rispondere a questa email.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - I tuoi link di accesso

Ciao,

Hai richiesto l'accesso al tuo{{#if isMultiple}}i{{/if}} portale{{#if isMultiple}}i{{/if}} clienti.
{{#if isMultiple}}Abbiamo trovato {{tenantCount}} organizzazioni associate al tuo indirizzo email.{{else}}Ecco il tuo link di accesso:{{/if}}

I tuoi link di accesso:
{{tenantLinksText}}

Nota di sicurezza: Se non hai richiesto questi link di accesso, puoi ignorare questa email in tutta sicurezza.

Se hai domande o hai bisogno di assistenza, contatta il team di supporto della tua organizzazione.

---
© {{currentYear}} {{platformName}}. Tutti i diritti riservati.
Questo è un messaggio automatico. Non rispondere a questa email.`
    },
    {
      name: 'no-account-found',
      language_code: 'it',
      subject: '{{platformName}} - Richiesta di accesso',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Ciao,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Abbiamo ricevuto una richiesta di accesso al portale clienti utilizzando questo indirizzo email.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Se hai un account con noi, dovresti aver ricevuto un'email separata con i tuoi link di accesso.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Se non hai ricevuto l'email di accesso, potrebbe significare:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Questo indirizzo email non è associato a un account del portale clienti</li>
              <li>Il tuo account potrebbe essere inattivo</li>
              <li>L'email potrebbe essere stata filtrata nella cartella spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Hai bisogno di aiuto?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Se ritieni di dover avere accesso a un portale clienti, contatta il team di supporto del tuo provider di servizi per assistenza.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota di sicurezza:</strong> Se non hai richiesto l'accesso, puoi ignorare questa email in tutta sicurezza.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tutti i diritti riservati.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Questo è un messaggio automatico. Non rispondere a questa email.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Richiesta di accesso

Ciao,

Abbiamo ricevuto una richiesta di accesso al portale clienti utilizzando questo indirizzo email.

Se hai un account con noi, dovresti aver ricevuto un'email separata con i tuoi link di accesso.

Se non hai ricevuto l'email di accesso, potrebbe significare:
- Questo indirizzo email non è associato a un account del portale clienti
- Il tuo account potrebbe essere inattivo
- L'email potrebbe essere stata filtrata nella cartella spam

Hai bisogno di aiuto?
Se ritieni di dover avere accesso a un portale clienti, contatta il team di supporto del tuo provider di servizi per assistenza.

Nota di sicurezza: Se non hai richiesto l'accesso, puoi ignorare questa email in tutta sicurezza.

---
© {{currentYear}} {{platformName}}. Tutti i diritti riservati.
Questo è un messaggio automatico. Non rispondere a questa email.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'it',
      subject: 'Ticket assegnato • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket assegnato</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ti è stato assegnato un ticket per <strong>{{ticket.clientName}}</strong>. Consulta i dettagli qui sotto e procedi con le attività necessarie.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorità</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Stato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato da</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Richiedente</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Sede</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Descrizione</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Apri ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniamo i team allineati</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket assegnato a te

{{ticket.metaLine}}
Assegnato da: {{ticket.assignedBy}}

Priorità: {{ticket.priority}}
Stato: {{ticket.status}}
Assegnato a: {{ticket.assignedDetails}}
Richiedente: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Categoria: {{ticket.categoryDetails}}
Sede: {{ticket.locationSummary}}

Descrizione:
{{ticket.description}}

Apri ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'it',
      subject: 'Nuovo ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nuovo ticket Creato</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">È stato registrato un nuovo ticket per <strong>{{ticket.clientName}}</strong>. Consulta il riepilogo qui sotto e utilizza il link per intervenire.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorità</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Stato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Creato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Richiedente</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Sede</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Descrizione</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Apri ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniamo i team allineati</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nuovo ticket creato per {{ticket.clientName}}

{{ticket.metaLine}}
Creato: {{ticket.createdAt}} · {{ticket.createdBy}}

Priorità: {{ticket.priority}}
Stato: {{ticket.status}}
Assegnato a: {{ticket.assignedDetails}}
Richiedente: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Categoria: {{ticket.categoryDetails}}
Sede: {{ticket.locationSummary}}

Descrizione:
{{ticket.description}}

Apri ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'it',
      subject: 'Ticket aggiornato • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket aggiornato</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">È stato aggiornato un ticket per <strong>{{ticket.clientName}}</strong>. Consulta le modifiche riportate qui sotto.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorità</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Stato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Aggiornato da</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Richiedente</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Sede</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Modifiche effettuate</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Apri ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniamo i team allineati</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket aggiornato

{{ticket.metaLine}}
Aggiornato da: {{ticket.updatedBy}}

Priorità: {{ticket.priority}}
Stato: {{ticket.status}}
Assegnato a: {{ticket.assignedDetails}}
Richiedente: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Categoria: {{ticket.categoryDetails}}
Sede: {{ticket.locationSummary}}

Modifiche effettuate:
{{ticket.changes}}

Apri ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'it',
      subject: 'Ticket chiuso • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket chiuso</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">È stato risolto e chiuso un ticket per <strong>{{ticket.clientName}}</strong>. Consulta i dettagli della risoluzione di seguito.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Stato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Chiuso</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Chiuso da</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Richiedente</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Sede</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Risoluzione</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Apri ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniamo i team allineati</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket chiuso

{{ticket.metaLine}}
Chiuso da: {{ticket.closedBy}}

Stato: Chiuso
Assegnato a: {{ticket.assignedDetails}}
Richiedente: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Categoria: {{ticket.categoryDetails}}
Sede: {{ticket.locationSummary}}

Risoluzione:
{{ticket.resolution}}

Apri ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'it',
      subject: 'Nuovo commento • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nuovo commento aggiunto</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">È stato aggiunto un nuovo commento a un ticket per <strong>{{ticket.clientName}}</strong>.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorità</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Stato</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Commento di</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assegnato a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Richiedente</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoria</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Sede</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Commento</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Apri ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniamo i team allineati</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nuovo commento aggiunto

{{ticket.metaLine}}
Commento di: {{comment.author}}

Priorità: {{ticket.priority}}
Stato: {{ticket.status}}
Assegnato a: {{ticket.assignedDetails}}
Richiedente: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Categoria: {{ticket.categoryDetails}}
Sede: {{ticket.locationSummary}}

Commento:
{{comment.content}}

Apri ticket: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'it',
      subject: 'Nuova fattura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Fattura {{invoice.number}}</h2>
        <p>È stata generata una nuova fattura da esaminare:</p>
        <div class="details">
          <p><strong>Numero fattura:</strong> {{invoice.number}}</p>
          <p><strong>Importo:</strong> {{invoice.amount}}</p>
          <p><strong>Data di scadenza:</strong> {{invoice.dueDate}}</p>
          <p><strong>Cliente:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Apri la fattura</a>
      `,
      text_content: `
Fattura {{invoice.number}}

È stata generata una nuova fattura da esaminare:

Numero fattura: {{invoice.number}}
Importo: {{invoice.amount}}
Data di scadenza: {{invoice.dueDate}}
Cliente: {{invoice.clientName}}

Apri la fattura: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'it',
      subject: 'Pagamento ricevuto: Fattura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Pagamento ricevuto</h2>
        <p>È stato ricevuto il pagamento della fattura #{{invoice.number}}:</p>
        <div class="details">
          <p><strong>Numero fattura:</strong> {{invoice.number}}</p>
          <p><strong>Importo pagato:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Data del pagamento:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Metodo di pagamento:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Apri la fattura</a>
      `,
      text_content: `
Pagamento ricevuto

È stato ricevuto il pagamento della fattura #{{invoice.number}}:

Numero fattura: {{invoice.number}}
Importo pagato: {{invoice.amountPaid}}
Data del pagamento: {{invoice.paymentDate}}
Metodo di pagamento: {{invoice.paymentMethod}}

Apri la fattura: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'it',
      subject: 'Pagamento in ritardo: Fattura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Pagamento in ritardo</h2>
        <p>Il pagamento della fattura #{{invoice.number}} è in ritardo:</p>
        <div class="details">
          <p><strong>Numero fattura:</strong> {{invoice.number}}</p>
          <p><strong>Importo dovuto:</strong> {{invoice.amountDue}}</p>
          <p><strong>Data di scadenza:</strong> {{invoice.dueDate}}</p>
          <p><strong>Giorni di ritardo:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Apri la fattura</a>
      `,
      text_content: `
Pagamento in ritardo

Il pagamento della fattura #{{invoice.number}} è in ritardo:

Numero fattura: {{invoice.number}}
Importo dovuto: {{invoice.amountDue}}
Data di scadenza: {{invoice.dueDate}}
Giorni di ritardo: {{invoice.daysOverdue}}

Apri la fattura: {{invoice.url}}
      `
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ Italian email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove Italian email templates
  // NOTE: email-verification and portal-invitation are NOT removed as they're managed by other migrations
  await knex('system_email_templates')
    .where({ language_code: 'it' })
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

  console.log('Italian email templates removed');
};
