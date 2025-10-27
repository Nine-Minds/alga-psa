/**
 * Add French translations for client-facing email templates
 *
 * Translates authentication, ticketing, and billing email templates to French
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding French email templates...');

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

  // Insert French templates
  await knex('system_email_templates').insert([
    // Authentication templates
    {
      name: 'email-verification',
      language_code: 'fr',
      subject: 'Vérifiez votre email{{#if registrationClientName}} pour {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Vérification d'email</h2>
          <p>Bonjour,</p>
          <p>Veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous :</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Vérifier l'email</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Ce lien expirera dans {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cet email, veuillez l'ignorer.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Vérification d'email

Veuillez vérifier votre adresse email en visitant :
{{verificationUrl}}

{{#if expirationTime}}Ce lien expirera dans {{expirationTime}}.{{/if}}

Si vous n'avez pas demandé cet email, veuillez l'ignorer.

© {{currentYear}} {{tenantClientName}}`
    },
    {
      name: 'password-reset',
      language_code: 'fr',
      subject: 'Demande de réinitialisation du mot de passe',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Réinitialisation du mot de passe</h2>
          <p>Bonjour {{userName}},</p>
          <p>Vous avez demandé à réinitialiser votre mot de passe pour {{email}}. Cliquez sur le lien ci-dessous pour continuer :</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Réinitialiser le mot de passe</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{resetLink}}</p>
          <p><small>Ce lien expirera dans {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email. Votre mot de passe restera inchangé.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Besoin d'aide ? Contactez {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Demande de réinitialisation du mot de passe

Bonjour {{userName}},

Vous avez demandé à réinitialiser votre mot de passe pour {{email}}. Visitez le lien suivant :
{{resetLink}}

Ce lien expirera dans {{expirationTime}}.

Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.
{{#if supportEmail}}Besoin d'aide ? Contactez {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'portal-invitation',
      language_code: 'fr',
      subject: 'Invitation au portail client - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Bienvenue sur votre portail client</h2>
          <p>Bonjour {{contactName}},</p>
          <p>Vous êtes invité à rejoindre le portail client de {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Activer mon accès</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{portalLink}}</p>
          <p><small>Le lien expirera dans {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Besoin d'assistance ?</p>
          <p style="color: #666; font-size: 12px;">Email : {{clientLocationEmail}}<br>Téléphone : {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Bienvenue sur votre portail client

Bonjour {{contactName}},

Vous êtes invité à rejoindre le portail client de {{clientName}}.

Activer mon accès : {{portalLink}}

Le lien expirera dans {{expirationTime}}.

Besoin d'assistance ?
Email : {{clientLocationEmail}}
Téléphone : {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'tenant-recovery',
      language_code: 'fr',
      subject: '{{platformName}} - Vos liens de connexion',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Vous avez demandé l'accès à votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Nous avons trouvé {{tenantCount}} organisations associées à votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de sécurité :</strong> Si vous n'avez pas demandé ces liens de connexion, vous pouvez ignorer cet e-mail en toute sécurité. Votre compte reste sécurisé.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si vous avez des questions ou besoin d'assistance, veuillez contacter l'équipe d'assistance de votre organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tous droits réservés.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Vos liens de connexion

Bonjour,

Vous avez demandé l'accès à votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Nous avons trouvé {{tenantCount}} organisations associées à votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}

Vos liens de connexion :
{{tenantLinksText}}

Note de sécurité : Si vous n'avez pas demandé ces liens de connexion, vous pouvez ignorer cet e-mail en toute sécurité.

Si vous avez des questions ou besoin d'assistance, veuillez contacter l'équipe d'assistance de votre organisation.

---
© {{currentYear}} {{platformName}}. Tous droits réservés.
Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.`
    },
    {
      name: 'no-account-found',
      language_code: 'fr',
      subject: '{{platformName}} - Demande d\'accès',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Nous avons reçu une demande d'accès au portail client utilisant cette adresse e-mail.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si vous avez un compte chez nous, vous devriez avoir reçu un e-mail séparé avec vos liens de connexion.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si vous n'avez pas reçu d'e-mail de connexion, cela peut signifier :
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Cette adresse e-mail n'est associée à aucun compte de portail client</li>
              <li>Votre compte peut être inactif</li>
              <li>L'e-mail peut avoir été filtré vers votre dossier spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Besoin d'aide ?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si vous pensez que vous devriez avoir accès à un portail client, veuillez contacter l'équipe d'assistance de votre fournisseur de services pour obtenir de l'aide.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de sécurité :</strong> Si vous n'avez pas demandé d'accès, vous pouvez ignorer cet e-mail en toute sécurité.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tous droits réservés.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Demande d'accès

Bonjour,

Nous avons reçu une demande d'accès au portail client utilisant cette adresse e-mail.

Si vous avez un compte chez nous, vous devriez avoir reçu un e-mail séparé avec vos liens de connexion.

Si vous n'avez pas reçu d'e-mail de connexion, cela peut signifier :
- Cette adresse e-mail n'est associée à aucun compte de portail client
- Votre compte peut être inactif
- L'e-mail peut avoir été filtré vers votre dossier spam

Besoin d'aide ?
Si vous pensez que vous devriez avoir accès à un portail client, veuillez contacter l'équipe d'assistance de votre fournisseur de services pour obtenir de l'aide.

Note de sécurité : Si vous n'avez pas demandé d'accès, vous pouvez ignorer cet e-mail en toute sécurité.

---
© {{currentYear}} {{platformName}}. Tous droits réservés.
Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'fr',
      subject: 'Vous avez été assigné au ticket : {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
        <h2>Ticket assigné</h2>
        <p>Vous avez été assigné à un ticket :</p>
        <div class="details">
          <p><strong>ID du ticket :</strong> {{ticket.id}}</p>
          <p><strong>Titre :</strong> {{ticket.title}}</p>
          <p><strong>Priorité :</strong> {{ticket.priority}}</p>
          <p><strong>Statut :</strong> {{ticket.status}}</p>
          <p><strong>Assigné par :</strong> {{ticket.assignedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Voir le ticket</a>
      `,
      text_content: `
Ticket assigné

Vous avez été assigné à un ticket :

ID du ticket : {{ticket.id}}
Titre : {{ticket.title}}
Priorité : {{ticket.priority}}
Statut : {{ticket.status}}
Assigné par : {{ticket.assignedBy}}

Voir le ticket : {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'fr',
      subject: 'Nouveau ticket : {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
        <h2>Nouveau ticket créé</h2>
        <p>Un nouveau ticket a été créé dans votre système PSA :</p>
        <div class="details">
          <p><strong>ID du ticket :</strong> {{ticket.id}}</p>
          <p><strong>Titre :</strong> {{ticket.title}}</p>
          <p><strong>Description :</strong> {{ticket.description}}</p>
          <p><strong>Priorité :</strong> {{ticket.priority}}</p>
          <p><strong>Statut :</strong> {{ticket.status}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Voir le ticket</a>
      `,
      text_content: `
Nouveau ticket créé

Un nouveau ticket a été créé dans votre système PSA :

ID du ticket : {{ticket.id}}
Titre : {{ticket.title}}
Description : {{ticket.description}}
Priorité : {{ticket.priority}}
Statut : {{ticket.status}}

Voir le ticket : {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'fr',
      subject: 'Ticket mis à jour : {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
        <h2>Ticket mis à jour</h2>
        <p>Un ticket a été mis à jour dans votre système PSA :</p>
        <div class="details">
          <p><strong>ID du ticket :</strong> {{ticket.id}}</p>
          <p><strong>Titre :</strong> {{ticket.title}}</p>
          <p><strong>Modifications :</strong> {{ticket.changes}}</p>
          <p><strong>Mis à jour par :</strong> {{ticket.updatedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Voir le ticket</a>
      `,
      text_content: `
Ticket mis à jour

Un ticket a été mis à jour dans votre système PSA :

ID du ticket : {{ticket.id}}
Titre : {{ticket.title}}
Modifications : {{ticket.changes}}
Mis à jour par : {{ticket.updatedBy}}

Voir le ticket : {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'fr',
      subject: 'Ticket fermé : {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
        <h2>Ticket fermé</h2>
        <p>Un ticket a été fermé dans votre système PSA :</p>
        <div class="details">
          <p><strong>ID du ticket :</strong> {{ticket.id}}</p>
          <p><strong>Titre :</strong> {{ticket.title}}</p>
          <p><strong>Résolution :</strong> {{ticket.resolution}}</p>
          <p><strong>Fermé par :</strong> {{ticket.closedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Voir le ticket</a>
      `,
      text_content: `
Ticket fermé

Un ticket a été fermé dans votre système PSA :

ID du ticket : {{ticket.id}}
Titre : {{ticket.title}}
Résolution : {{ticket.resolution}}
Fermé par : {{ticket.closedBy}}

Voir le ticket : {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'fr',
      subject: 'Nouveau commentaire sur le ticket : {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
        <h2>Nouveau commentaire ajouté</h2>
        <p>Un nouveau commentaire a été ajouté au ticket :</p>
        <div class="details">
          <p><strong>ID du ticket :</strong> {{ticket.id}}</p>
          <p><strong>Titre :</strong> {{ticket.title}}</p>
          <p><strong>Commentaire de :</strong> {{comment.author}}</p>
          <p><strong>Commentaire :</strong></p>
          <div class="comment-content">
            {{comment.content}}
          </div>
        </div>
        <a href="{{ticket.url}}" class="button">Voir le ticket</a>
      `,
      text_content: `
Nouveau commentaire ajouté

Un nouveau commentaire a été ajouté au ticket :

ID du ticket : {{ticket.id}}
Titre : {{ticket.title}}
Commentaire de : {{comment.author}}

Commentaire :
{{comment.content}}

Voir le ticket : {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'fr',
      subject: 'Nouvelle facture #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Facture {{invoice.number}}</h2>
        <p>Une nouvelle facture a été générée pour votre examen :</p>
        <div class="details">
          <p><strong>Numéro de facture :</strong> {{invoice.number}}</p>
          <p><strong>Montant :</strong> {{invoice.amount}}</p>
          <p><strong>Date d'échéance :</strong> {{invoice.dueDate}}</p>
          <p><strong>Client :</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Voir la facture</a>
      `,
      text_content: `
Facture {{invoice.number}}

Une nouvelle facture a été générée pour votre examen :

Numéro de facture : {{invoice.number}}
Montant : {{invoice.amount}}
Date d'échéance : {{invoice.dueDate}}
Client : {{invoice.clientName}}

Voir la facture : {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'fr',
      subject: 'Paiement reçu : Facture #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Paiement reçu</h2>
        <p>Le paiement a été reçu pour la facture #{{invoice.number}} :</p>
        <div class="details">
          <p><strong>Numéro de facture :</strong> {{invoice.number}}</p>
          <p><strong>Montant payé :</strong> {{invoice.amountPaid}}</p>
          <p><strong>Date de paiement :</strong> {{invoice.paymentDate}}</p>
          <p><strong>Méthode de paiement :</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Voir la facture</a>
      `,
      text_content: `
Paiement reçu

Le paiement a été reçu pour la facture #{{invoice.number}} :

Numéro de facture : {{invoice.number}}
Montant payé : {{invoice.amountPaid}}
Date de paiement : {{invoice.paymentDate}}
Méthode de paiement : {{invoice.paymentMethod}}

Voir la facture : {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'fr',
      subject: 'Paiement en retard : Facture #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Paiement en retard</h2>
        <p>Le paiement de la facture #{{invoice.number}} est en retard :</p>
        <div class="details">
          <p><strong>Numéro de facture :</strong> {{invoice.number}}</p>
          <p><strong>Montant dû :</strong> {{invoice.amountDue}}</p>
          <p><strong>Date d'échéance :</strong> {{invoice.dueDate}}</p>
          <p><strong>Jours de retard :</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Voir la facture</a>
      `,
      text_content: `
Paiement en retard

Le paiement de la facture #{{invoice.number}} est en retard :

Numéro de facture : {{invoice.number}}
Montant dû : {{invoice.amountDue}}
Date d'échéance : {{invoice.dueDate}}
Jours de retard : {{invoice.daysOverdue}}

Voir la facture : {{invoice.url}}
      `
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ French email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove French email templates
  await knex('system_email_templates')
    .where({ language_code: 'fr' })
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

  console.log('French email templates removed');
};
