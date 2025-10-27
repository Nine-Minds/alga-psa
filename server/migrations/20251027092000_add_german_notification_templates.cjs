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
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Passwort zurücksetzen</h2>
          <p>Hallo {{userName}},</p>
          <p>Sie haben angefordert, Ihr Passwort für {{email}} zurückzusetzen. Klicken Sie auf den untenstehenden Link, um fortzufahren:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Passwort zurücksetzen</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{resetLink}}</p>
          <p><small>Dieser Link läuft in {{expirationTime}} ab.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Wenn Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail bitte. Ihr Passwort bleibt unverändert.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Benötigen Sie Hilfe? Kontaktieren Sie {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Passwort-Zurücksetzungsanfrage

Hallo {{userName}},

Sie haben angefordert, Ihr Passwort für {{email}} zurückzusetzen. Besuchen Sie folgenden Link:
{{resetLink}}

Dieser Link läuft in {{expirationTime}} ab.

Wenn Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail bitte.
{{#if supportEmail}}Benötigen Sie Hilfe? Kontaktieren Sie {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`
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
      subject: 'Ihnen wurde ein Ticket zugewiesen: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
        <h2>Ticket zugewiesen</h2>
        <p>Ihnen wurde ein Ticket zugewiesen:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Priorität:</strong> {{ticket.priority}}</p>
          <p><strong>Status:</strong> {{ticket.status}}</p>
          <p><strong>Zugewiesen von:</strong> {{ticket.assignedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket anzeigen</a>
      `,
      text_content: `
Ticket zugewiesen

Ihnen wurde ein Ticket zugewiesen:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Priorität: {{ticket.priority}}
Status: {{ticket.status}}
Zugewiesen von: {{ticket.assignedBy}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'de',
      subject: 'Neues Ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
        <h2>Neues Ticket erstellt</h2>
        <p>Ein neues Ticket wurde in Ihrem PSA-System erstellt:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Beschreibung:</strong> {{ticket.description}}</p>
          <p><strong>Priorität:</strong> {{ticket.priority}}</p>
          <p><strong>Status:</strong> {{ticket.status}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket anzeigen</a>
      `,
      text_content: `
Neues Ticket erstellt

Ein neues Ticket wurde in Ihrem PSA-System erstellt:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Beschreibung: {{ticket.description}}
Priorität: {{ticket.priority}}
Status: {{ticket.status}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'de',
      subject: 'Ticket aktualisiert: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
        <h2>Ticket aktualisiert</h2>
        <p>Ein Ticket wurde in Ihrem PSA-System aktualisiert:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Änderungen:</strong> {{ticket.changes}}</p>
          <p><strong>Aktualisiert von:</strong> {{ticket.updatedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket anzeigen</a>
      `,
      text_content: `
Ticket aktualisiert

Ein Ticket wurde in Ihrem PSA-System aktualisiert:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Änderungen: {{ticket.changes}}
Aktualisiert von: {{ticket.updatedBy}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'de',
      subject: 'Ticket geschlossen: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
        <h2>Ticket geschlossen</h2>
        <p>Ein Ticket wurde in Ihrem PSA-System geschlossen:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Lösung:</strong> {{ticket.resolution}}</p>
          <p><strong>Geschlossen von:</strong> {{ticket.closedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket anzeigen</a>
      `,
      text_content: `
Ticket geschlossen

Ein Ticket wurde in Ihrem PSA-System geschlossen:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Lösung: {{ticket.resolution}}
Geschlossen von: {{ticket.closedBy}}

Ticket anzeigen: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'de',
      subject: 'Neuer Kommentar zum Ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
        <h2>Neuer Kommentar hinzugefügt</h2>
        <p>Ein neuer Kommentar wurde zum Ticket hinzugefügt:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Kommentar von:</strong> {{comment.author}}</p>
          <p><strong>Kommentar:</strong></p>
          <div class="comment-content">
            {{comment.content}}
          </div>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket anzeigen</a>
      `,
      text_content: `
Neuer Kommentar hinzugefügt

Ein neuer Kommentar wurde zum Ticket hinzugefügt:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Kommentar von: {{comment.author}}

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
