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
    {
      name: 'email-verification',
      language_code: 'nl',
      subject: 'Verifieer uw e-mailadres{{#if registrationClientName}} voor {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>E-mailverificatie</h2>
          <p>Hallo,</p>
          <p>Verifieer uw e-mailadres door op onderstaande link te klikken:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">E-mail verifiëren</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Deze link verloopt over {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Als u deze e-mail niet heeft aangevraagd, kunt u deze negeren.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `E-mailverificatie

Verifieer uw e-mailadres door naar deze link te gaan:
{{verificationUrl}}

{{#if expirationTime}}Deze link verloopt over {{expirationTime}}.{{/if}}

Als u deze e-mail niet heeft aangevraagd, kunt u deze negeren.

© {{currentYear}} {{tenantClientName}}`
    },
    {
      name: 'password-reset',
      language_code: 'nl',
      subject: 'Verzoek tot wachtwoordherstel',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Wachtwoord opnieuw instellen</h2>
          <p>Hallo {{userName}},</p>
          <p>U heeft verzocht om uw wachtwoord voor {{email}} opnieuw in te stellen. Klik op onderstaande link om door te gaan:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Wachtwoord opnieuw instellen</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{resetLink}}</p>
          <p><small>Deze link verloopt over {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Als u dit wachtwoordherstel niet heeft aangevraagd, kunt u deze e-mail negeren. Uw wachtwoord blijft ongewijzigd.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Hulp nodig? Neem contact op met {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Verzoek tot wachtwoordherstel

Hallo {{userName}},

U heeft verzocht om uw wachtwoord voor {{email}} opnieuw in te stellen. Bezoek de volgende link:
{{resetLink}}

Deze link verloopt over {{expirationTime}}.

Als u dit wachtwoordherstel niet heeft aangevraagd, kunt u deze e-mail negeren.
{{#if supportEmail}}Hulp nodig? Neem contact op met {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'portal-invitation',
      language_code: 'nl',
      subject: 'Uitnodiging voor klantenportaal - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welkom bij uw klantenportaal</h2>
          <p>Hallo {{contactName}},</p>
          <p>U bent uitgenodigd om lid te worden van het klantenportaal van {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Toegang activeren</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{portalLink}}</p>
          <p><small>De link verloopt over {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Hulp nodig?</p>
          <p style="color: #666; font-size: 12px;">E-mail: {{clientLocationEmail}}<br>Telefoon: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Welkom bij uw klantenportaal

Hallo {{contactName}},

U bent uitgenodigd om lid te worden van het klantenportaal van {{clientName}}.

Toegang activeren: {{portalLink}}

De link verloopt over {{expirationTime}}.

Hulp nodig?
E-mail: {{clientLocationEmail}}
Telefoon: {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
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
      subject: 'U heeft een ticket toegewezen gekregen: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
        <h2>Ticket toegewezen</h2>
        <p>U heeft een ticket toegewezen gekregen:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Prioriteit:</strong> {{ticket.priority}}</p>
          <p><strong>Status:</strong> {{ticket.status}}</p>
          <p><strong>Toegewezen door:</strong> {{ticket.assignedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket bekijken</a>
      `,
      text_content: `
Ticket toegewezen

U heeft een ticket toegewezen gekregen:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}
Toegewezen door: {{ticket.assignedBy}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'nl',
      subject: 'Nieuw ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
        <h2>Nieuw ticket aangemaakt</h2>
        <p>Een nieuw ticket is aangemaakt in uw PSA-systeem:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Beschrijving:</strong> {{ticket.description}}</p>
          <p><strong>Prioriteit:</strong> {{ticket.priority}}</p>
          <p><strong>Status:</strong> {{ticket.status}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket bekijken</a>
      `,
      text_content: `
Nieuw ticket aangemaakt

Een nieuw ticket is aangemaakt in uw PSA-systeem:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Beschrijving: {{ticket.description}}
Prioriteit: {{ticket.priority}}
Status: {{ticket.status}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'nl',
      subject: 'Ticket bijgewerkt: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
        <h2>Ticket bijgewerkt</h2>
        <p>Een ticket is bijgewerkt in uw PSA-systeem:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Wijzigingen:</strong> {{ticket.changes}}</p>
          <p><strong>Bijgewerkt door:</strong> {{ticket.updatedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket bekijken</a>
      `,
      text_content: `
Ticket bijgewerkt

Een ticket is bijgewerkt in uw PSA-systeem:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Wijzigingen: {{ticket.changes}}
Bijgewerkt door: {{ticket.updatedBy}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'nl',
      subject: 'Ticket gesloten: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
        <h2>Ticket gesloten</h2>
        <p>Een ticket is gesloten in uw PSA-systeem:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Oplossing:</strong> {{ticket.resolution}}</p>
          <p><strong>Gesloten door:</strong> {{ticket.closedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket bekijken</a>
      `,
      text_content: `
Ticket gesloten

Een ticket is gesloten in uw PSA-systeem:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Oplossing: {{ticket.resolution}}
Gesloten door: {{ticket.closedBy}}

Ticket bekijken: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'nl',
      subject: 'Nieuwe opmerking bij ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
        <h2>Nieuwe opmerking toegevoegd</h2>
        <p>Een nieuwe opmerking is toegevoegd aan het ticket:</p>
        <div class="details">
          <p><strong>Ticket-ID:</strong> {{ticket.id}}</p>
          <p><strong>Titel:</strong> {{ticket.title}}</p>
          <p><strong>Opmerking van:</strong> {{comment.author}}</p>
          <p><strong>Opmerking:</strong></p>
          <div class="comment-content">
            {{comment.content}}
          </div>
        </div>
        <a href="{{ticket.url}}" class="button">Ticket bekijken</a>
      `,
      text_content: `
Nieuwe opmerking toegevoegd

Een nieuwe opmerking is toegevoegd aan het ticket:

Ticket-ID: {{ticket.id}}
Titel: {{ticket.title}}
Opmerking van: {{comment.author}}

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
  await knex('system_email_templates')
    .where({ language_code: 'nl' })
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

  console.log('Dutch email templates removed');
};
