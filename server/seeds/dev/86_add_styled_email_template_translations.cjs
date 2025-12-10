/**
 * Add multi-language email templates with full styled HTML
 * Ensures visual consistency across all languages by using complete template definitions
 *
 * This seed adds authentication, ticket, and appointment notification templates for:
 * - French (fr)
 * - Spanish (es)
 * - German (de)
 * - Dutch (nl)
 * - Italian (it)
 *
 * Templates for each language:
 * Authentication:
 * - email-verification
 * - password-reset
 * - portal-invitation
 * - tenant-recovery
 * - no-account-found
 *
 * Ticketing:
 * - ticket-created
 * - ticket-assigned
 * - ticket-updated
 * - ticket-closed
 * - ticket-comment-added
 *
 * Appointments:
 * - appointment-request-received
 * - appointment-request-approved
 * - appointment-request-declined
 * - new-appointment-request
 */

exports.seed = async function(knex) {
  console.log('Adding styled multi-language email templates...');

  // Get notification subtypes
  const subtypes = await knex('notification_subtypes')
    .select('id', 'name')
    .whereIn('name', [
      'email-verification',
      'password-reset',
      'portal-invitation',
      'tenant-recovery',
      'no-account-found',
      'Ticket Created',
      'Ticket Assigned',
      'Ticket Updated',
      'Ticket Closed',
      'Ticket Comment Added',
      'appointment-request-received',
      'appointment-request-approved',
      'appointment-request-declined',
      'new-appointment-request'
    ]);

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      console.warn(`⚠️  Notification subtype '${name}' not found, skipping related templates`);
      return null;
    }
    return subtype.id;
  };

  // Helper function to insert templates, filtering out those with null notification_subtype_id
  const insertTemplates = async (templates, language) => {
    const validTemplates = templates.filter(t => t.notification_subtype_id !== null);
    const skippedCount = templates.length - validTemplates.length;

    if (skippedCount > 0) {
      console.log(`  ⚠️  Skipped ${skippedCount} ${language} template(s) due to missing notification subtypes`);
    }

    if (validTemplates.length > 0) {
      await knex('system_email_templates')
        .insert(validTemplates)
        .onConflict(['name', 'language_code'])
        .merge({
          subject: knex.raw('excluded.subject'),
          html_content: knex.raw('excluded.html_content'),
          text_content: knex.raw('excluded.text_content'),
          notification_subtype_id: knex.raw('excluded.notification_subtype_id')
        });
      console.log(`  ✓ Added/updated ${validTemplates.length} ${language} template(s)`);
    }
  };

  // French (fr) templates
  console.log('Adding French templates...');
  const frenchTemplates = [
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
      subject: 'Demande de Réinitialisation du Mot de Passe',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demande de Réinitialisation du Mot de Passe</title>
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
    <h1>Demande de Réinitialisation du Mot de Passe</h1>
    <p>Récupération sécurisée du mot de passe de votre compte</p>
  </div>

  <div class="content">
    <h2>Bonjour {{userName}},</h2>

    <p>Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte associé à <strong>{{email}}</strong>.</p>

    <div class="security-box">
      <h3>🔐 Vérification de Sécurité du Compte</h3>
      <p><strong>Demandé :</strong> À l'instant</p>
      <p><strong>E-mail du compte :</strong> {{email}}</p>
      <p><strong>Valable pendant :</strong> {{expirationTime}}</p>
    </div>

    <p>Pour créer un nouveau mot de passe pour votre compte, cliquez sur le bouton ci-dessous :</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Réinitialiser Votre Mot de Passe</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Ou copiez et collez ce lien dans votre navigateur :
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Informations de Sécurité Importantes</h4>
      <ul>
        <li>Ce lien de réinitialisation expirera dans <strong>{{expirationTime}}</strong></li>
        <li>Pour des raisons de sécurité, ce lien ne peut être utilisé qu'<strong>une seule fois</strong></li>
        <li>Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail</li>
        <li>Votre mot de passe ne changera pas tant que vous n'en créerez pas un nouveau</li>
      </ul>
    </div>

    <h3>Et Ensuite ?</h3>
    <ol>
      <li>Cliquez sur le bouton de réinitialisation ci-dessus ou utilisez le lien fourni</li>
      <li>Créez un mot de passe fort et unique pour votre compte</li>
      <li>Vous serez automatiquement connecté après la réinitialisation</li>
      <li>Toutes les sessions existantes seront fermées pour des raisons de sécurité</li>
      <li>Envisagez d'activer l'authentification à deux facteurs pour une protection accrue</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>Besoin d'Aide ?</h4>
      <p>Si vous rencontrez des difficultés pour réinitialiser votre mot de passe, notre équipe d'assistance est là pour vous aider.</p>
      <p style="margin-top: 12px;"><strong>Contacter l'Assistance :</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>Ceci est un e-mail de sécurité automatisé envoyé à {{email}}.</p>
    <p>Pour votre sécurité, nous n'incluons jamais de mots de passe dans les e-mails.</p>
    <p>© {{currentYear}} {{clientName}}. Tous droits réservés.</p>
  </div>
</body>
</html>
      `,
      text_content: `Demande de Réinitialisation du Mot de Passe

Bonjour {{userName}},

Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte associé à {{email}}.

VÉRIFICATION DE SÉCURITÉ DU COMPTE
- Demandé : À l'instant
- E-mail du compte : {{email}}
- Valable pendant : {{expirationTime}}

Pour créer un nouveau mot de passe, visitez le lien suivant :
{{resetLink}}

INFORMATIONS DE SÉCURITÉ IMPORTANTES :
- Ce lien expirera dans {{expirationTime}}
- Ne peut être utilisé qu'une seule fois
- Si vous n'avez pas demandé cela, ignorez cet e-mail
- Votre mot de passe ne changera pas tant que vous n'en créerez pas un nouveau

ET ENSUITE :
1. Utilisez le lien fourni ci-dessus
2. Créez un mot de passe fort et unique
3. Vous serez automatiquement connecté
4. Toutes les sessions existantes seront fermées
5. Envisagez d'activer l'authentification à deux facteurs

Besoin d'aide ?
Contacter l'Assistance : {{supportEmail}}

---
Ceci est un e-mail de sécurité automatisé envoyé à {{email}}.
© {{currentYear}} {{clientName}}. Tous droits réservés.`
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
      name: 'ticket-created',
      language_code: 'fr',
      subject: 'Nouveau Ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nouveau Ticket Créé</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Un nouveau ticket a été enregistré pour <strong>{{ticket.clientName}}</strong>. Consultez le résumé ci-dessous et suivez le lien pour agir.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorité</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Statut</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Créé</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné à</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Demandeur</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tableau</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Catégorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Emplacement</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Description</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Voir le Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Maintenir les équipes alignées</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nouveau Ticket Créé pour {{ticket.clientName}}

{{ticket.metaLine}}
Créé : {{ticket.createdAt}} · {{ticket.createdBy}}

Priorité : {{ticket.priority}}
Statut : {{ticket.status}}
Assigné à : {{ticket.assignedDetails}}
Demandeur : {{ticket.requesterDetails}}
Tableau : {{ticket.board}}
Catégorie : {{ticket.categoryDetails}}
Emplacement : {{ticket.locationSummary}}

Description :
{{ticket.description}}

Voir le ticket : {{ticket.url}}
      `
    },
    {
      name: 'ticket-assigned',
      language_code: 'fr',
      subject: 'Ticket Assigné • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Assigné</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Ce ticket vous a été assigné pour <strong>{{ticket.clientName}}</strong>. Consultez les détails ci-dessous et prenez les mesures appropriées.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorité</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Statut</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné par</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné à</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Demandeur</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tableau</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Catégorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Emplacement</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Description</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Voir le Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Gardons les équipes alignées</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Assigné à Vous

{{ticket.metaLine}}
Assigné par: {{ticket.assignedBy}}

Priorité: {{ticket.priority}}
Statut: {{ticket.status}}
Assigné à: {{ticket.assignedDetails}}
Demandeur: {{ticket.requesterDetails}}
Tableau: {{ticket.board}}
Catégorie: {{ticket.categoryDetails}}
Emplacement: {{ticket.locationSummary}}

Description:
{{ticket.description}}

Voir le ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'fr',
      subject: 'Ticket Mis à Jour • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Mis à Jour</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Un ticket a été mis à jour pour <strong>{{ticket.clientName}}</strong>. Consultez les modifications ci-dessous.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorité</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Statut</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Mis à jour par</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné à</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Demandeur</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tableau</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Catégorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Emplacement</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Modifications</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Voir le Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Gardons les équipes alignées</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Mis à Jour

{{ticket.metaLine}}
Mis à jour par: {{ticket.updatedBy}}

Priorité: {{ticket.priority}}
Statut: {{ticket.status}}
Assigné à: {{ticket.assignedDetails}}
Demandeur: {{ticket.requesterDetails}}
Tableau: {{ticket.board}}
Catégorie: {{ticket.categoryDetails}}
Emplacement: {{ticket.locationSummary}}

Modifications:
{{ticket.changes}}

Voir le ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'fr',
      subject: 'Ticket Fermé • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Fermé</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Un ticket a été résolu et fermé pour <strong>{{ticket.clientName}}</strong>. Consultez les détails de la résolution ci-dessous.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Statut</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Fermé</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Fermé par</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné à</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Demandeur</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tableau</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Catégorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Emplacement</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Résolution</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Voir le Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Gardons les équipes alignées</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Fermé

{{ticket.metaLine}}
Fermé par: {{ticket.closedBy}}

Statut: Fermé
Assigné à: {{ticket.assignedDetails}}
Demandeur: {{ticket.requesterDetails}}
Tableau: {{ticket.board}}
Catégorie: {{ticket.categoryDetails}}
Emplacement: {{ticket.locationSummary}}

Résolution:
{{ticket.resolution}}

Voir le ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'fr',
      subject: 'Nouveau Commentaire • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nouveau Commentaire Ajouté</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Un nouveau commentaire a été ajouté à un ticket pour <strong>{{ticket.clientName}}</strong>.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priorité</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Statut</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Commentaire de</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigné à</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Demandeur</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tableau</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Catégorie</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Emplacement</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Commentaire</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Voir le Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Gardons les équipes alignées</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nouveau Commentaire Ajouté

{{ticket.metaLine}}
Commentaire de: {{comment.author}}

Priorité: {{ticket.priority}}
Statut: {{ticket.status}}
Assigné à: {{ticket.assignedDetails}}
Demandeur: {{ticket.requesterDetails}}
Tableau: {{ticket.board}}
Catégorie: {{ticket.categoryDetails}}
Emplacement: {{ticket.locationSummary}}

Commentaire:
{{comment.content}}

Voir le ticket: {{ticket.url}}
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
  ];

  await insertTemplates(frenchTemplates, 'French');
  console.log('✓ French email templates added (auth + tickets + billing)');

  // Spanish (es) templates
  console.log('Adding Spanish templates...');
  const spanishTemplates = [
    // Authentication templates
    {
      name: 'email-verification',
      language_code: 'es',
      subject: 'Verifica tu correo electrónico{{#if registrationClientName}} para {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verificación de correo electrónico</h2>
          <p>Hola,</p>
          <p>Por favor verifica tu dirección de correo electrónico haciendo clic en el enlace a continuación:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verificar correo</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Este enlace expirará en {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste este correo, por favor ignóralo.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Verificación de correo electrónico

Por favor verifica tu dirección de correo electrónico visitando:
{{verificationUrl}}

{{#if expirationTime}}Este enlace expirará en {{expirationTime}}.{{/if}}

Si no solicitaste este correo, por favor ignóralo.

© {{currentYear}} {{tenantClientName}}`
    },
    {
      name: 'password-reset',
      language_code: 'es',
      subject: 'Solicitud de Restablecimiento de Contraseña',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud de Restablecimiento de Contraseña</title>
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
    <h1>Solicitud de Restablecimiento de Contraseña</h1>
    <p>Recuperación segura de contraseña para tu cuenta</p>
  </div>

  <div class="content">
    <h2>Hola {{userName}},</h2>

    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta asociada con <strong>{{email}}</strong>.</p>

    <div class="security-box">
      <h3>🔐 Verificación de Seguridad de la Cuenta</h3>
      <p><strong>Solicitado:</strong> Hace un momento</p>
      <p><strong>Correo de la cuenta:</strong> {{email}}</p>
      <p><strong>Válido por:</strong> {{expirationTime}}</p>
    </div>

    <p>Para crear una nueva contraseña para tu cuenta, haz clic en el botón a continuación:</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Restablecer Tu Contraseña</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      O copia y pega este enlace en tu navegador:
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>⚠️ Información de Seguridad Importante</h4>
      <ul>
        <li>Este enlace de restablecimiento expirará en <strong>{{expirationTime}}</strong></li>
        <li>Por razones de seguridad, este enlace solo se puede usar <strong>una vez</strong></li>
        <li>Si no solicitaste este restablecimiento, ignora este correo</li>
        <li>Tu contraseña no cambiará hasta que crees una nueva</li>
      </ul>
    </div>

    <h3>¿Qué Sigue?</h3>
    <ol>
      <li>Haz clic en el botón de restablecimiento arriba o usa el enlace proporcionado</li>
      <li>Crea una contraseña fuerte y única para tu cuenta</li>
      <li>Iniciarás sesión automáticamente después de restablecer</li>
      <li>Todas las sesiones existentes se terminarán por seguridad</li>
      <li>Considera habilitar la autenticación de dos factores para mayor protección</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>¿Necesitas Ayuda?</h4>
      <p>Si tienes problemas para restablecer tu contraseña, nuestro equipo de soporte está aquí para ayudarte.</p>
      <p style="margin-top: 12px;"><strong>Contactar Soporte:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>Este es un correo de seguridad automático enviado a {{email}}.</p>
    <p>Por tu seguridad, nunca incluimos contraseñas en los correos.</p>
    <p>© {{currentYear}} {{clientName}}. Todos los derechos reservados.</p>
  </div>
</body>
</html>
      `,
      text_content: `Solicitud de Restablecimiento de Contraseña

Hola {{userName}},

Recibimos una solicitud para restablecer la contraseña de tu cuenta asociada con {{email}}.

VERIFICACIÓN DE SEGURIDAD DE LA CUENTA
- Solicitado: Hace un momento
- Correo de la cuenta: {{email}}
- Válido por: {{expirationTime}}

Para crear una nueva contraseña, visita el siguiente enlace:
{{resetLink}}

INFORMACIÓN DE SEGURIDAD IMPORTANTE:
- Este enlace expirará en {{expirationTime}}
- Solo se puede usar una vez
- Si no solicitaste esto, ignora este correo
- Tu contraseña no cambiará hasta que crees una nueva

QUÉ SIGUE:
1. Usa el enlace proporcionado arriba
2. Crea una contraseña fuerte y única
3. Iniciarás sesión automáticamente
4. Todas las sesiones existentes se terminarán
5. Considera habilitar autenticación de dos factores

¿Necesitas ayuda?
Contactar Soporte: {{supportEmail}}

---
Este es un correo de seguridad automático enviado a {{email}}.
© {{currentYear}} {{clientName}}. Todos los derechos reservados.`
    },
    {
      name: 'portal-invitation',
      language_code: 'es',
      subject: 'Invitación al portal del cliente - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Bienvenido a tu portal del cliente</h2>
          <p>Hola {{contactName}},</p>
          <p>Has sido invitado a unirte al portal del cliente de {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Activar mi acceso</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{portalLink}}</p>
          <p><small>El enlace expirará en {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">¿Necesitas asistencia?</p>
          <p style="color: #666; font-size: 12px;">Email: {{clientLocationEmail}}<br>Teléfono: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Bienvenido a tu portal del cliente

Hola {{contactName}},

Has sido invitado a unirte al portal del cliente de {{clientName}}.

Activar mi acceso: {{portalLink}}

El enlace expirará en {{expirationTime}}.

¿Necesitas asistencia?
Email: {{clientLocationEmail}}
Teléfono: {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'tenant-recovery',
      language_code: 'es',
      subject: '{{platformName}} - Tus enlaces de inicio de sesión',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura. Tu cuenta permanece segura.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Tus enlaces de inicio de sesión

Hola,

Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}

Tus enlaces de inicio de sesión:
{{tenantLinksText}}

Nota de seguridad: Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura.

Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`
    },
    {
      name: 'no-account-found',
      language_code: 'es',
      subject: '{{platformName}} - Solicitud de acceso',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si no recibiste un correo de inicio de sesión, puede significar:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente</li>
              <li>Tu cuenta puede estar inactiva</li>
              <li>El correo puede haber sido filtrado a tu carpeta de spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>¿Necesitas ayuda?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste acceso, puedes ignorar este correo de forma segura.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Solicitud de acceso

Hola,

Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.

Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.

Si no recibiste un correo de inicio de sesión, puede significar:
- Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente
- Tu cuenta puede estar inactiva
- El correo puede haber sido filtrado a tu carpeta de spam

¿Necesitas ayuda?
Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.

Nota de seguridad: Si no solicitaste acceso, puedes ignorar este correo de forma segura.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`
    },

    // Ticketing templates (Spanish already has these in the migration, keeping them here for completeness)
    {
      name: 'ticket-created',
      language_code: 'es',
      subject: 'Nuevo Ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nuevo Ticket Creado</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Se ha registrado un nuevo ticket para <strong>{{ticket.clientName}}</strong>. Revisa el resumen a continuación y sigue el enlace para tomar acción.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioridad</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Estado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Creado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Solicitante</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablero</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoría</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Ubicación</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Descripción</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ver Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniendo a los equipos alineados</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nuevo Ticket Creado para {{ticket.clientName}}

{{ticket.metaLine}}
Creado: {{ticket.createdAt}} · {{ticket.createdBy}}

Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}
Asignado a: {{ticket.assignedDetails}}
Solicitante: {{ticket.requesterDetails}}
Tablero: {{ticket.board}}
Categoría: {{ticket.categoryDetails}}
Ubicación: {{ticket.locationSummary}}

Descripción:
{{ticket.description}}

Ver ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-assigned',
      language_code: 'es',
      subject: 'Ticket Asignado • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Asignado</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Se te ha asignado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los detalles a continuación y toma acción.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioridad</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Estado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado por</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Solicitante</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablero</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoría</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Ubicación</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Descripción</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ver Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniendo a los equipos alineados</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Asignado a Ti

{{ticket.metaLine}}
Asignado por: {{ticket.assignedBy}}

Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}
Asignado a: {{ticket.assignedDetails}}
Solicitante: {{ticket.requesterDetails}}
Tablero: {{ticket.board}}
Categoría: {{ticket.categoryDetails}}
Ubicación: {{ticket.locationSummary}}

Descripción:
{{ticket.description}}

Ver ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'es',
      subject: 'Ticket Actualizado • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Actualizado</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Se ha actualizado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los cambios a continuación.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioridad</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Estado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Actualizado por</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Solicitante</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablero</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoría</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Ubicación</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Cambios Realizados</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ver Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniendo a los equipos alineados</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Actualizado

{{ticket.metaLine}}
Actualizado por: {{ticket.updatedBy}}

Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}
Asignado a: {{ticket.assignedDetails}}
Solicitante: {{ticket.requesterDetails}}
Tablero: {{ticket.board}}
Categoría: {{ticket.categoryDetails}}
Ubicación: {{ticket.locationSummary}}

Cambios realizados:
{{ticket.changes}}

Ver ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'es',
      subject: 'Ticket Cerrado • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Cerrado</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Se ha resuelto y cerrado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los detalles de la resolución a continuación.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Estado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Cerrado</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Cerrado por</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Solicitante</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablero</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoría</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Ubicación</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Resolución</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ver Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniendo a los equipos alineados</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Cerrado

{{ticket.metaLine}}
Cerrado por: {{ticket.closedBy}}

Estado: Cerrado
Asignado a: {{ticket.assignedDetails}}
Solicitante: {{ticket.requesterDetails}}
Tablero: {{ticket.board}}
Categoría: {{ticket.categoryDetails}}
Ubicación: {{ticket.locationSummary}}

Resolución:
{{ticket.resolution}}

Ver ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'es',
      subject: 'Nuevo Comentario • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Nuevo Comentario Agregado</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Se ha agregado un nuevo comentario a un ticket para <strong>{{ticket.clientName}}</strong>.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Prioridad</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Estado</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Comentario de</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Asignado a</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Solicitante</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Tablero</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Categoría</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Ubicación</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Comentario</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Ver Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Manteniendo a los equipos alineados</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Nuevo Comentario Agregado

{{ticket.metaLine}}
Comentario de: {{comment.author}}

Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}
Asignado a: {{ticket.assignedDetails}}
Solicitante: {{ticket.requesterDetails}}
Tablero: {{ticket.board}}
Categoría: {{ticket.categoryDetails}}
Ubicación: {{ticket.locationSummary}}

Comentario:
{{comment.content}}

Ver ticket: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'es',
      subject: 'Nueva factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Factura {{invoice.number}}</h2>
        <p>Se ha generado una nueva factura para tu revisión:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto:</strong> {{invoice.amount}}</p>
          <p><strong>Fecha de vencimiento:</strong> {{invoice.dueDate}}</p>
          <p><strong>Cliente:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Factura {{invoice.number}}

Se ha generado una nueva factura para tu revisión:

Número de factura: {{invoice.number}}
Monto: {{invoice.amount}}
Fecha de vencimiento: {{invoice.dueDate}}
Cliente: {{invoice.clientName}}

Ver la factura: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'es',
      subject: 'Pago recibido: Factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Pago recibido</h2>
        <p>Se ha recibido el pago de la factura #{{invoice.number}}:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto pagado:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Fecha de pago:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Método de pago:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Pago recibido

Se ha recibido el pago de la factura #{{invoice.number}}:

Número de factura: {{invoice.number}}
Monto pagado: {{invoice.amountPaid}}
Fecha de pago: {{invoice.paymentDate}}
Método de pago: {{invoice.paymentMethod}}

Ver la factura: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'es',
      subject: 'Pago vencido: Factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Pago vencido</h2>
        <p>El pago de la factura #{{invoice.number}} está vencido:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto adeudado:</strong> {{invoice.amountDue}}</p>
          <p><strong>Fecha de vencimiento:</strong> {{invoice.dueDate}}</p>
          <p><strong>Días de retraso:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Pago vencido

El pago de la factura #{{invoice.number}} está vencido:

Número de factura: {{invoice.number}}
Monto adeudado: {{invoice.amountDue}}
Fecha de vencimiento: {{invoice.dueDate}}
Días de retraso: {{invoice.daysOverdue}}

Ver la factura: {{invoice.url}}
      `
    }
  ];

  await insertTemplates(spanishTemplates, 'Spanish');
  console.log('✓ Spanish email templates added (auth + tickets + billing)');

  // German (de) templates
  console.log('Adding German templates...');
  const germanTemplates = [
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
  ];

  await insertTemplates(germanTemplates, 'German');
  console.log('✓ German email templates added (auth + tickets + billing)');

  // Dutch (nl) templates
  console.log('Adding Dutch templates...');
  const dutchTemplates = [
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
  ];

  await insertTemplates(dutchTemplates, 'Dutch');
  console.log('✓ Dutch email templates added (auth + tickets + billing)');

  // Italian (it) templates
  console.log('Adding Italian templates...');
  const italianTemplates = [
// Authentication templates
    {
      name: 'email-verification',
      language_code: 'it',
      subject: 'Verifica il tuo indirizzo email{{#if registrationClientName}} per {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verifica email</h2>
          <p>Ciao,</p>
          <p>Per favore verifica il tuo indirizzo email cliccando sul pulsante qui sotto:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verifica email</a></p>
          <p>Oppure copia e incolla questo link nel tuo browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Questo link scadrà tra {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Se non hai richiesto questa email, ignorala pure.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Verifica email

Per favore verifica il tuo indirizzo email visitando:
{{verificationUrl}}

{{#if expirationTime}}Questo link scadrà tra {{expirationTime}}.{{/if}}

Se non hai richiesto questa email, ignorala pure.

© {{currentYear}} {{tenantClientName}}`
    },
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
    {
      name: 'portal-invitation',
      language_code: 'it',
      subject: 'Invito al portale clienti - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Benvenuto nel portale clienti</h2>
          <p>Ciao {{contactName}},</p>
          <p>Hai ricevuto un invito per accedere al portale clienti di {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Attiva il mio accesso</a></p>
          <p>Oppure copia e incolla questo link nel tuo browser:</p>
          <p>{{portalLink}}</p>
          <p><small>Il link scadrà tra {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Serve supporto?</p>
          <p style="color: #666; font-size: 12px;">Email: {{clientLocationEmail}}<br>Telefono: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Benvenuto nel portale clienti

Ciao {{contactName}},

Hai ricevuto un invito per accedere al portale clienti di {{clientName}}.

Attiva il mio accesso: {{portalLink}}

Il link scadrà tra {{expirationTime}}.

Serve supporto?
Email: {{clientLocationEmail}}
Telefono: {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
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
  ];

  await insertTemplates(italianTemplates, 'Italian');
  console.log('✓ Italian email templates added (auth + tickets + billing + appointments)');

  
  // ==================== APPOINTMENT REQUEST TEMPLATES ====================
  console.log('Adding appointment request email templates...');

  // French appointment templates
  
  console.log('Adding French templates...');
  const frenchAppointmentTemplates = [
    {
      name: 'appointment-request-received',
      language_code: 'fr',
      subject: 'Demande de rendez-vous reçue - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demande de rendez-vous reçue</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Demande reçue</h1>
      <p>Nous avons reçu votre demande de rendez-vous</p>
    </div>

    <div class="content">
      <p class="greeting">Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Merci d'avoir soumis votre demande de rendez-vous. Nous avons bien reçu votre demande et notre équipe l'examinera sous peu.
      </p>

      <div class="reference-number">
        Référence : {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Détails de la demande</h3>
        <div class="detail-row">
          <span class="detail-label">Service :</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date demandée :</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Heure demandée :</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Durée :</span>
          <span class="detail-value">{{duration}} minutes</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Technicien préféré :</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>Quelle est la prochaine étape ?</strong></p>
        <p>Notre équipe examinera votre demande et confirmera la disponibilité. Vous recevrez une notification par e-mail une fois que votre rendez-vous aura été approuvé ou si des modifications sont nécessaires. Nous répondons généralement dans un délai de {{responseTime}}.</p>
      </div>

      <p class="message">
        Si vous avez des questions ou si vous devez apporter des modifications à votre demande, veuillez nous contacter à {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Demande de rendez-vous reçue

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Merci d'avoir soumis votre demande de rendez-vous. Nous avons bien reçu votre demande et notre équipe l'examinera sous peu.

Numéro de référence : {{referenceNumber}}

DÉTAILS DE LA DEMANDE :
Service : {{serviceName}}
Date demandée : {{requestedDate}}
Heure demandée : {{requestedTime}}
Durée : {{duration}} minutes
{{#if preferredTechnician}}Technicien préféré : {{preferredTechnician}}{{/if}}

QUELLE EST LA PROCHAINE ÉTAPE ?
Notre équipe examinera votre demande et confirmera la disponibilité. Vous recevrez une notification par e-mail une fois que votre rendez-vous aura été approuvé ou si des modifications sont nécessaires. Nous répondons généralement dans un délai de {{responseTime}}.

Si vous avez des questions ou si vous devez apporter des modifications à votre demande, veuillez nous contacter à {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'fr',
      subject: 'Rendez-vous confirmé - {{serviceName}} le {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rendez-vous confirmé</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Rendez-vous confirmé</h1>
      <p>Votre rendez-vous a été approuvé</p>
    </div>

    <div class="content">
      <p class="greeting">Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Excellente nouvelle ! Votre demande de rendez-vous a été approuvée et confirmée. Nous sommes impatients de vous servir.
      </p>

      <div class="appointment-box">
        <h3>Votre rendez-vous</h3>
        <div class="appointment-detail">
          <strong>Service</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Date</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Heure</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Durée</strong>
          <span>{{duration}} minutes</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Technicien assigné</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>E-mail : {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Téléphone : {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Ajouter au calendrier</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Politique d'annulation</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        Si vous devez reporter ou annuler ce rendez-vous, veuillez nous contacter au moins {{minimumNoticeHours}} heures à l'avance à {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.
      </p>

      <p class="message">
        Nous vous enverrons un rappel avant votre rendez-vous. À bientôt !
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Rendez-vous confirmé

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Excellente nouvelle ! Votre demande de rendez-vous a été approuvée et confirmée. Nous sommes impatients de vous servir.

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

{{#if calendarLink}}
Ajouter au calendrier : {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
POLITIQUE D'ANNULATION :
{{cancellationPolicy}}
{{/if}}

Si vous devez reporter ou annuler ce rendez-vous, veuillez nous contacter au moins {{minimumNoticeHours}} heures à l'avance à {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.

Nous vous enverrons un rappel avant votre rendez-vous. À bientôt !`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'fr',
      subject: 'Mise à jour de la demande de rendez-vous - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mise à jour de la demande de rendez-vous</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Mise à jour de la demande</h1>
      <p>Concernant votre demande de rendez-vous récente</p>
    </div>

    <div class="content">
      <p class="greeting">Bonjour{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Merci de votre intérêt pour la prise de rendez-vous avec nous. Malheureusement, nous ne sommes pas en mesure de répondre à votre demande à l'heure demandée.
      </p>

      <div class="details-box">
        <h3>Demande initiale</h3>
        <div class="detail-row">
          <span class="detail-label">Service :</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date demandée :</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Heure demandée :</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Référence :</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Raison</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>Nous serions ravis de vous aider</h4>
        <p>Nous nous excusons pour tout désagrément. Nous vous encourageons à soumettre une nouvelle demande pour une date et une heure alternatives qui correspondent mieux à notre disponibilité.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Demander un autre créneau</a>
        {{/if}}
      </div>

      <p class="message">
        Si vous avez des questions ou si vous souhaitez de l'aide pour trouver un créneau disponible, n'hésitez pas à nous contacter à {{contactEmail}}{{#if contactPhone}} ou à appeler le {{contactPhone}}{{/if}}. Notre équipe est là pour vous aider à trouver un horaire qui vous convient.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Mise à jour de la demande de rendez-vous

Bonjour{{#if requesterName}} {{requesterName}}{{/if}},

Merci de votre intérêt pour la prise de rendez-vous avec nous. Malheureusement, nous ne sommes pas en mesure de répondre à votre demande à l'heure demandée.

DEMANDE INITIALE :
Service : {{serviceName}}
Date demandée : {{requestedDate}}
Heure demandée : {{requestedTime}}
Référence : {{referenceNumber}}

{{#if declineReason}}
RAISON :
{{declineReason}}
{{/if}}

NOUS SERIONS RAVIS DE VOUS AIDER
Nous nous excusons pour tout désagrément. Nous vous encourageons à soumettre une nouvelle demande pour une date et une heure alternatives qui correspondent mieux à notre disponibilité.

{{#if requestNewAppointmentLink}}
Demander un autre créneau : {{requestNewAppointmentLink}}
{{/if}}

Si vous avez des questions ou si vous souhaitez de l'aide pour trouver un créneau disponible, n'hésitez pas à nous contacter à {{contactEmail}}{{#if contactPhone}} ou à appeler le {{contactPhone}}{{/if}}. Notre équipe est là pour vous aider à trouver un horaire qui vous convient.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'fr',
      subject: 'Nouvelle demande de rendez-vous - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nouvelle demande de rendez-vous</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Nouvelle demande de rendez-vous</h1>
      <p>Action requise</p>
      {{#if isUrgent}}
      <span class="badge">URGENT</span>
      {{/if}}
    </div>

    <div class="content">
      <p class="greeting">Bonjour,</p>

      <p class="message">
        Une nouvelle demande de rendez-vous a été soumise et nécessite votre examen.
      </p>

      <div class="details-box">
        <h3>Détails de la demande</h3>
        <div class="detail-row">
          <span class="detail-label">Client :</span>
          <span class="detail-value">{{clientName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Demandeur :</span>
          <span class="detail-value">{{requesterName}}</span>
        </div>
        {{#if requesterEmail}}
        <div class="detail-row">
          <span class="detail-label">E-mail :</span>
          <span class="detail-value">{{requesterEmail}}</span>
        </div>
        {{/if}}
        {{#if requesterPhone}}
        <div class="detail-row">
          <span class="detail-label">Téléphone :</span>
          <span class="detail-value">{{requesterPhone}}</span>
        </div>
        {{/if}}
        <div class="detail-row">
          <span class="detail-label">Service :</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date demandée :</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Heure demandée :</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Durée :</span>
          <span class="detail-value">{{duration}} minutes</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Technicien préféré :</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if notes}}
      <div class="info-box">
        <p><strong>Notes du client :</strong></p>
        <p>{{notes}}</p>
      </div>
      {{/if}}

      <div style="text-align: center; margin: 24px 0;">
        <a href="{{reviewLink}}" class="action-button">Examiner et répondre</a>
      </div>

      <p class="message" style="text-align: center; color: #64748b; font-size: 14px;">
        Référence de la demande : {{referenceNumber}}
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Nouvelle demande de rendez-vous

Une nouvelle demande de rendez-vous a été soumise et nécessite votre examen.

DÉTAILS DE LA DEMANDE :
Client : {{clientName}}
Demandeur : {{requesterName}}
{{#if requesterEmail}}E-mail : {{requesterEmail}}{{/if}}
{{#if requesterPhone}}Téléphone : {{requesterPhone}}{{/if}}
Service : {{serviceName}}
Date demandée : {{requestedDate}}
Heure demandée : {{requestedTime}}
Durée : {{duration}} minutes
{{#if preferredTechnician}}Technicien préféré : {{preferredTechnician}}{{/if}}

{{#if notes}}
NOTES DU CLIENT :
{{notes}}
{{/if}}

Référence de la demande : {{referenceNumber}}

Examiner et répondre : {{reviewLink}}`
    }
  ];

  await insertTemplates(frenchAppointmentTemplates, 'French');
  console.log('✓ French appointment email templates added');

  // Spanish appointment templates
  
  console.log('Adding Spanish templates...');
  const spanishAppointmentTemplates = [
    {
      name: 'appointment-request-received',
      language_code: 'es',
      subject: 'Solicitud de cita recibida - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud de cita recibida</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Solicitud recibida</h1>
      <p>Hemos recibido su solicitud de cita</p>
    </div>

    <div class="content">
      <p class="greeting">Hola{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisará en breve.
      </p>

      <div class="reference-number">
        Referencia: {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Detalles de la solicitud</h3>
        <div class="detail-row">
          <span class="detail-label">Servicio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fecha solicitada:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hora solicitada:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duración:</span>
          <span class="detail-value">{{duration}} minutos</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Técnico preferido:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>¿Qué sigue?</strong></p>
        <p>Nuestro equipo revisará su solicitud y confirmará la disponibilidad. Recibirá una notificación por correo electrónico una vez que su cita haya sido aprobada o si se necesitan cambios. Normalmente respondemos dentro de {{responseTime}}.</p>
      </div>

      <p class="message">
        Si tiene alguna pregunta o necesita realizar cambios en su solicitud, por favor contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Solicitud de cita recibida

Hola{{#if requesterName}} {{requesterName}}{{/if}},

Gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisará en breve.

Número de referencia: {{referenceNumber}}

DETALLES DE LA SOLICITUD:
Servicio: {{serviceName}}
Fecha solicitada: {{requestedDate}}
Hora solicitada: {{requestedTime}}
Duración: {{duration}} minutos
{{#if preferredTechnician}}Técnico preferido: {{preferredTechnician}}{{/if}}

¿QUÉ SIGUE?
Nuestro equipo revisará su solicitud y confirmará la disponibilidad. Recibirá una notificación por correo electrónico una vez que su cita haya sido aprobada o si se necesitan cambios. Normalmente respondemos dentro de {{responseTime}}.

Si tiene alguna pregunta o necesita realizar cambios en su solicitud, por favor contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'es',
      subject: 'Cita confirmada - {{serviceName}} el {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cita confirmada</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Cita confirmada</h1>
      <p>Su cita ha sido aprobada</p>
    </div>

    <div class="content">
      <p class="greeting">Hola{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        ¡Excelentes noticias! Su solicitud de cita ha sido aprobada y confirmada. Esperamos poder servirle.
      </p>

      <div class="appointment-box">
        <h3>Su cita</h3>
        <div class="appointment-detail">
          <strong>Servicio</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Fecha</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Hora</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Duración</strong>
          <span>{{duration}} minutos</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Técnico asignado</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>Correo: {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Teléfono: {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Agregar al calendario</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Política de cancelación</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        Si necesita reprogramar o cancelar esta cita, por favor contáctenos con al menos {{minimumNoticeHours}} horas de anticipación en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.
      </p>

      <p class="message">
        Le enviaremos un recordatorio antes de su cita. ¡Hasta pronto!
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Cita confirmada

Hola{{#if requesterName}} {{requesterName}}{{/if}},

¡Excelentes noticias! Su solicitud de cita ha sido aprobada y confirmada. Esperamos poder servirle.

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

{{#if calendarLink}}
Agregar al calendario: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
POLÍTICA DE CANCELACIÓN:
{{cancellationPolicy}}
{{/if}}

Si necesita reprogramar o cancelar esta cita, por favor contáctenos con al menos {{minimumNoticeHours}} horas de anticipación en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.

Le enviaremos un recordatorio antes de su cita. ¡Hasta pronto!`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'es',
      subject: 'Actualización de solicitud de cita - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actualización de solicitud de cita</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Actualización de solicitud</h1>
      <p>Respecto a su solicitud de cita reciente</p>
    </div>

    <div class="content">
      <p class="greeting">Hola{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Gracias por su interés en programar una cita con nosotros. Lamentablemente, no podemos acomodar su solicitud en el horario solicitado.
      </p>

      <div class="details-box">
        <h3>Solicitud original</h3>
        <div class="detail-row">
          <span class="detail-label">Servicio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fecha solicitada:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hora solicitada:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Referencia:</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Motivo</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>Nos encantaría ayudarle</h4>
        <p>Pedimos disculpas por cualquier inconveniente. Le animamos a enviar una nueva solicitud para una fecha y hora alternativa que funcione mejor con nuestra disponibilidad.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Solicitar otro horario</a>
        {{/if}}
      </div>

      <p class="message">
        Si tiene alguna pregunta o desea ayuda para encontrar un horario disponible, no dude en contactarnos en {{contactEmail}}{{#if contactPhone}} o llamar al {{contactPhone}}{{/if}}. Nuestro equipo está aquí para ayudarle a encontrar un horario que le funcione.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Actualización de solicitud de cita

Hola{{#if requesterName}} {{requesterName}}{{/if}},

Gracias por su interés en programar una cita con nosotros. Lamentablemente, no podemos acomodar su solicitud en el horario solicitado.

SOLICITUD ORIGINAL:
Servicio: {{serviceName}}
Fecha solicitada: {{requestedDate}}
Hora solicitada: {{requestedTime}}
Referencia: {{referenceNumber}}

{{#if declineReason}}
MOTIVO:
{{declineReason}}
{{/if}}

NOS ENCANTARÍA AYUDARLE
Pedimos disculpas por cualquier inconveniente. Le animamos a enviar una nueva solicitud para una fecha y hora alternativa que funcione mejor con nuestra disponibilidad.

{{#if requestNewAppointmentLink}}
Solicitar otro horario: {{requestNewAppointmentLink}}
{{/if}}

Si tiene alguna pregunta o desea ayuda para encontrar un horario disponible, no dude en contactarnos en {{contactEmail}}{{#if contactPhone}} o llamar al {{contactPhone}}{{/if}}. Nuestro equipo está aquí para ayudarle a encontrar un horario que le funcione.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'es',
      subject: 'Nueva solicitud de cita - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nueva solicitud de cita</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Nueva solicitud de cita</h1>
      <p>Acción requerida</p>
      {{#if isUrgent}}
      <span class="badge">URGENTE</span>
      {{/if}}
    </div>

    <div class="content">
      <p class="greeting">Hola,</p>

      <p class="message">
        Se ha enviado una nueva solicitud de cita y requiere su revisión.
      </p>

      <div class="details-box">
        <h3>Detalles de la solicitud</h3>
        <div class="detail-row">
          <span class="detail-label">Cliente:</span>
          <span class="detail-value">{{clientName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Solicitante:</span>
          <span class="detail-value">{{requesterName}}</span>
        </div>
        {{#if requesterEmail}}
        <div class="detail-row">
          <span class="detail-label">Correo:</span>
          <span class="detail-value">{{requesterEmail}}</span>
        </div>
        {{/if}}
        {{#if requesterPhone}}
        <div class="detail-row">
          <span class="detail-label">Teléfono:</span>
          <span class="detail-value">{{requesterPhone}}</span>
        </div>
        {{/if}}
        <div class="detail-row">
          <span class="detail-label">Servicio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fecha solicitada:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hora solicitada:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duración:</span>
          <span class="detail-value">{{duration}} minutos</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Técnico preferido:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if notes}}
      <div class="info-box">
        <p><strong>Notas del cliente:</strong></p>
        <p>{{notes}}</p>
      </div>
      {{/if}}

      <div style="text-align: center; margin: 24px 0;">
        <a href="{{reviewLink}}" class="action-button">Revisar y responder</a>
      </div>

      <p class="message" style="text-align: center; color: #64748b; font-size: 14px;">
        Referencia de la solicitud: {{referenceNumber}}
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Nueva solicitud de cita

Se ha enviado una nueva solicitud de cita y requiere su revisión.

DETALLES DE LA SOLICITUD:
Cliente: {{clientName}}
Solicitante: {{requesterName}}
{{#if requesterEmail}}Correo: {{requesterEmail}}{{/if}}
{{#if requesterPhone}}Teléfono: {{requesterPhone}}{{/if}}
Servicio: {{serviceName}}
Fecha solicitada: {{requestedDate}}
Hora solicitada: {{requestedTime}}
Duración: {{duration}} minutos
{{#if preferredTechnician}}Técnico preferido: {{preferredTechnician}}{{/if}}

{{#if notes}}
NOTAS DEL CLIENTE:
{{notes}}
{{/if}}

Referencia de la solicitud: {{referenceNumber}}

Revisar y responder: {{reviewLink}}`
    }
  ];

  await insertTemplates(spanishAppointmentTemplates, 'Spanish');
  console.log('✓ Spanish appointment email templates added');

  // German appointment templates
  
  console.log('Adding German templates...');
  const germanAppointmentTemplates = [
    {
      name: 'appointment-request-received',
      language_code: 'de',
      subject: 'Terminanfrage erhalten - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terminanfrage erhalten</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Anfrage erhalten</h1>
      <p>Wir haben Ihre Terminanfrage erhalten</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Vielen Dank für Ihre Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in Kürze prüfen.
      </p>

      <div class="reference-number">
        Referenz: {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Anfragedetails</h3>
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschtes Datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschte Zeit:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Dauer:</span>
          <span class="detail-value">{{duration}} Minuten</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Bevorzugter Techniker:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>Wie geht es weiter?</strong></p>
        <p>Unser Team wird Ihre Anfrage prüfen und die Verfügbarkeit bestätigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls Änderungen erforderlich sind. Wir antworten in der Regel innerhalb von {{responseTime}}.</p>
      </div>

      <p class="message">
        Wenn Sie Fragen haben oder Änderungen an Ihrer Anfrage vornehmen möchten, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Terminanfrage erhalten

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Vielen Dank für Ihre Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in Kürze prüfen.

Referenznummer: {{referenceNumber}}

ANFRAGEDETAILS:
Service: {{serviceName}}
Gewünschtes Datum: {{requestedDate}}
Gewünschte Zeit: {{requestedTime}}
Dauer: {{duration}} Minuten
{{#if preferredTechnician}}Bevorzugter Techniker: {{preferredTechnician}}{{/if}}

WIE GEHT ES WEITER?
Unser Team wird Ihre Anfrage prüfen und die Verfügbarkeit bestätigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls Änderungen erforderlich sind. Wir antworten in der Regel innerhalb von {{responseTime}}.

Wenn Sie Fragen haben oder Änderungen an Ihrer Anfrage vornehmen möchten, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'de',
      subject: 'Termin bestätigt - {{serviceName}} am {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Termin bestätigt</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Termin bestätigt</h1>
      <p>Ihr Termin wurde genehmigt</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Großartige Neuigkeiten! Ihre Terminanfrage wurde genehmigt und bestätigt. Wir freuen uns darauf, Sie zu bedienen.
      </p>

      <div class="appointment-box">
        <h3>Ihr Termin</h3>
        <div class="appointment-detail">
          <strong>Service</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Datum</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Zeit</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Dauer</strong>
          <span>{{duration}} Minuten</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Zugewiesener Techniker</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>E-Mail: {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Telefon: {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Zum Kalender hinzufügen</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Stornierungsbedingungen</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        Wenn Sie diesen Termin verschieben oder stornieren müssen, kontaktieren Sie uns bitte mindestens {{minimumNoticeHours}} Stunden im Voraus unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.
      </p>

      <p class="message">
        Wir senden Ihnen vor Ihrem Termin eine Erinnerung. Bis bald!
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Termin bestätigt

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Großartige Neuigkeiten! Ihre Terminanfrage wurde genehmigt und bestätigt. Wir freuen uns darauf, Sie zu bedienen.

IHR TERMIN:
Service: {{serviceName}}
Datum: {{appointmentDate}}
Zeit: {{appointmentTime}}
Dauer: {{duration}} Minuten

{{#if technicianName}}
ZUGEWIESENER TECHNIKER:
{{technicianName}}
{{#if technicianEmail}}E-Mail: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Telefon: {{technicianPhone}}{{/if}}
{{/if}}

{{#if calendarLink}}
Zum Kalender hinzufügen: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
STORNIERUNGSBEDINGUNGEN:
{{cancellationPolicy}}
{{/if}}

Wenn Sie diesen Termin verschieben oder stornieren müssen, kontaktieren Sie uns bitte mindestens {{minimumNoticeHours}} Stunden im Voraus unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.

Wir senden Ihnen vor Ihrem Termin eine Erinnerung. Bis bald!`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'de',
      subject: 'Aktualisierung Ihrer Terminanfrage - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aktualisierung Ihrer Terminanfrage</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Aktualisierung der Anfrage</h1>
      <p>Bezüglich Ihrer kürzlichen Terminanfrage</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Vielen Dank für Ihr Interesse, einen Termin mit uns zu vereinbaren. Leider können wir Ihrer Anfrage zum gewünschten Zeitpunkt nicht nachkommen.
      </p>

      <div class="details-box">
        <h3>Ursprüngliche Anfrage</h3>
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschtes Datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschte Zeit:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Referenz:</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Grund</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>Wir helfen Ihnen gerne weiter</h4>
        <p>Wir entschuldigen uns für etwaige Unannehmlichkeiten. Wir ermutigen Sie, eine neue Anfrage für ein alternatives Datum und eine alternative Zeit einzureichen, die besser zu unserer Verfügbarkeit passen.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Andere Zeit anfragen</a>
        {{/if}}
      </div>

      <p class="message">
        Wenn Sie Fragen haben oder Hilfe bei der Suche nach einem verfügbaren Zeitfenster benötigen, zögern Sie bitte nicht, uns unter {{contactEmail}}{{#if contactPhone}} zu kontaktieren oder {{contactPhone}} anzurufen{{/if}}. Unser Team hilft Ihnen gerne, einen passenden Zeitpunkt zu finden.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Aktualisierung Ihrer Terminanfrage

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Vielen Dank für Ihr Interesse, einen Termin mit uns zu vereinbaren. Leider können wir Ihrer Anfrage zum gewünschten Zeitpunkt nicht nachkommen.

URSPRÜNGLICHE ANFRAGE:
Service: {{serviceName}}
Gewünschtes Datum: {{requestedDate}}
Gewünschte Zeit: {{requestedTime}}
Referenz: {{referenceNumber}}

{{#if declineReason}}
GRUND:
{{declineReason}}
{{/if}}

WIR HELFEN IHNEN GERNE WEITER
Wir entschuldigen uns für etwaige Unannehmlichkeiten. Wir ermutigen Sie, eine neue Anfrage für ein alternatives Datum und eine alternative Zeit einzureichen, die besser zu unserer Verfügbarkeit passen.

{{#if requestNewAppointmentLink}}
Andere Zeit anfragen: {{requestNewAppointmentLink}}
{{/if}}

Wenn Sie Fragen haben oder Hilfe bei der Suche nach einem verfügbaren Zeitfenster benötigen, zögern Sie bitte nicht, uns unter {{contactEmail}}{{#if contactPhone}} zu kontaktieren oder {{contactPhone}} anzurufen{{/if}}. Unser Team hilft Ihnen gerne, einen passenden Zeitpunkt zu finden.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'de',
      subject: 'Neue Terminanfrage - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neue Terminanfrage</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Neue Terminanfrage</h1>
      <p>Aktion erforderlich</p>
      {{#if isUrgent}}
      <span class="badge">DRINGEND</span>
      {{/if}}
    </div>

    <div class="content">
      <p class="greeting">Hallo,</p>

      <p class="message">
        Eine neue Terminanfrage wurde eingereicht und erfordert Ihre Prüfung.
      </p>

      <div class="details-box">
        <h3>Anfragedetails</h3>
        <div class="detail-row">
          <span class="detail-label">Kunde:</span>
          <span class="detail-value">{{clientName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Antragsteller:</span>
          <span class="detail-value">{{requesterName}}</span>
        </div>
        {{#if requesterEmail}}
        <div class="detail-row">
          <span class="detail-label">E-Mail:</span>
          <span class="detail-value">{{requesterEmail}}</span>
        </div>
        {{/if}}
        {{#if requesterPhone}}
        <div class="detail-row">
          <span class="detail-label">Telefon:</span>
          <span class="detail-value">{{requesterPhone}}</span>
        </div>
        {{/if}}
        <div class="detail-row">
          <span class="detail-label">Service:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschtes Datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gewünschte Zeit:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Dauer:</span>
          <span class="detail-value">{{duration}} Minuten</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Bevorzugter Techniker:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if notes}}
      <div class="info-box">
        <p><strong>Kundennotizen:</strong></p>
        <p>{{notes}}</p>
      </div>
      {{/if}}

      <div style="text-align: center; margin: 24px 0;">
        <a href="{{reviewLink}}" class="action-button">Prüfen und antworten</a>
      </div>

      <p class="message" style="text-align: center; color: #64748b; font-size: 14px;">
        Anfragereferenz: {{referenceNumber}}
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Neue Terminanfrage

Eine neue Terminanfrage wurde eingereicht und erfordert Ihre Prüfung.

ANFRAGEDETAILS:
Kunde: {{clientName}}
Antragsteller: {{requesterName}}
{{#if requesterEmail}}E-Mail: {{requesterEmail}}{{/if}}
{{#if requesterPhone}}Telefon: {{requesterPhone}}{{/if}}
Service: {{serviceName}}
Gewünschtes Datum: {{requestedDate}}
Gewünschte Zeit: {{requestedTime}}
Dauer: {{duration}} Minuten
{{#if preferredTechnician}}Bevorzugter Techniker: {{preferredTechnician}}{{/if}}

{{#if notes}}
KUNDENNOTIZEN:
{{notes}}
{{/if}}

Anfragereferenz: {{referenceNumber}}

Prüfen und antworten: {{reviewLink}}`
    }
  ];

  await insertTemplates(germanAppointmentTemplates, 'German');
  console.log('✓ German appointment email templates added');

  // Dutch appointment templates
  
  console.log('Adding Dutch templates...');
  const dutchAppointmentTemplates = [
    {
      name: 'appointment-request-received',
      language_code: 'nl',
      subject: 'Afspraakverzoek ontvangen - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Afspraakverzoek ontvangen</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Verzoek ontvangen</h1>
      <p>We hebben uw afspraakverzoek ontvangen</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Bedankt voor het indienen van uw afspraakverzoek. We hebben uw verzoek ontvangen en ons team zal het binnenkort beoordelen.
      </p>

      <div class="reference-number">
        Referentie: {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Verzoekdetails</h3>
        <div class="detail-row">
          <span class="detail-label">Dienst:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde tijd:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duur:</span>
          <span class="detail-value">{{duration}} minuten</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Voorkeurstechnicus:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>Wat gebeurt er nu?</strong></p>
        <p>Ons team zal uw verzoek beoordelen en de beschikbaarheid bevestigen. U ontvangt een e-mailmelding zodra uw afspraak is goedgekeurd of als er wijzigingen nodig zijn. We reageren doorgaans binnen {{responseTime}}.</p>
      </div>

      <p class="message">
        Als u vragen heeft of wijzigingen in uw verzoek wilt aanbrengen, neem dan contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Afspraakverzoek ontvangen

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Bedankt voor het indienen van uw afspraakverzoek. We hebben uw verzoek ontvangen en ons team zal het binnenkort beoordelen.

Referentienummer: {{referenceNumber}}

VERZOEKDETAILS:
Dienst: {{serviceName}}
Gevraagde datum: {{requestedDate}}
Gevraagde tijd: {{requestedTime}}
Duur: {{duration}} minuten
{{#if preferredTechnician}}Voorkeurstechnicus: {{preferredTechnician}}{{/if}}

WAT GEBEURT ER NU?
Ons team zal uw verzoek beoordelen en de beschikbaarheid bevestigen. U ontvangt een e-mailmelding zodra uw afspraak is goedgekeurd of als er wijzigingen nodig zijn. We reageren doorgaans binnen {{responseTime}}.

Als u vragen heeft of wijzigingen in uw verzoek wilt aanbrengen, neem dan contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'nl',
      subject: 'Afspraak bevestigd - {{serviceName}} op {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Afspraak bevestigd</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Afspraak bevestigd</h1>
      <p>Uw afspraak is goedgekeurd</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Geweldig nieuws! Uw afspraakverzoek is goedgekeurd en bevestigd. We kijken ernaar uit u te bedienen.
      </p>

      <div class="appointment-box">
        <h3>Uw afspraak</h3>
        <div class="appointment-detail">
          <strong>Dienst</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Datum</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Tijd</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Duur</strong>
          <span>{{duration}} minuten</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Toegewezen technicus</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>E-mail: {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Telefoon: {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Toevoegen aan agenda</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Annuleringsbeleid</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        Als u deze afspraak moet verzetten of annuleren, neem dan minimaal {{minimumNoticeHours}} uur van tevoren contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.
      </p>

      <p class="message">
        We sturen u een herinnering voordat uw afspraak plaatsvindt. Tot snel!
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Afspraak bevestigd

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Geweldig nieuws! Uw afspraakverzoek is goedgekeurd en bevestigd. We kijken ernaar uit u te bedienen.

UW AFSPRAAK:
Dienst: {{serviceName}}
Datum: {{appointmentDate}}
Tijd: {{appointmentTime}}
Duur: {{duration}} minuten

{{#if technicianName}}
TOEGEWEZEN TECHNICUS:
{{technicianName}}
{{#if technicianEmail}}E-mail: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}Telefoon: {{technicianPhone}}{{/if}}
{{/if}}

{{#if calendarLink}}
Toevoegen aan agenda: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
ANNULERINGSBELEID:
{{cancellationPolicy}}
{{/if}}

Als u deze afspraak moet verzetten of annuleren, neem dan minimaal {{minimumNoticeHours}} uur van tevoren contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.

We sturen u een herinnering voordat uw afspraak plaatsvindt. Tot snel!`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'nl',
      subject: 'Update afspraakverzoek - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Update afspraakverzoek</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Verzoek update</h1>
      <p>Met betrekking tot uw recente afspraakverzoek</p>
    </div>

    <div class="content">
      <p class="greeting">Hallo{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Bedankt voor uw interesse om een afspraak met ons te maken. Helaas kunnen we uw verzoek niet op de gevraagde tijd accommoderen.
      </p>

      <div class="details-box">
        <h3>Oorspronkelijk verzoek</h3>
        <div class="detail-row">
          <span class="detail-label">Dienst:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde tijd:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Referentie:</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Reden</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>We helpen u graag verder</h4>
        <p>Onze excuses voor het ongemak. We moedigen u aan om een nieuw verzoek in te dienen voor een alternatieve datum en tijd die beter past bij onze beschikbaarheid.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Andere tijd aanvragen</a>
        {{/if}}
      </div>

      <p class="message">
        Als u vragen heeft of hulp nodig heeft bij het vinden van een beschikbaar tijdslot, aarzel dan niet om contact met ons op te nemen via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}. Ons team helpt u graag bij het vinden van een geschikte tijd.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Update afspraakverzoek

Hallo{{#if requesterName}} {{requesterName}}{{/if}},

Bedankt voor uw interesse om een afspraak met ons te maken. Helaas kunnen we uw verzoek niet op de gevraagde tijd accommoderen.

OORSPRONKELIJK VERZOEK:
Dienst: {{serviceName}}
Gevraagde datum: {{requestedDate}}
Gevraagde tijd: {{requestedTime}}
Referentie: {{referenceNumber}}

{{#if declineReason}}
REDEN:
{{declineReason}}
{{/if}}

WE HELPEN U GRAAG VERDER
Onze excuses voor het ongemak. We moedigen u aan om een nieuw verzoek in te dienen voor een alternatieve datum en tijd die beter past bij onze beschikbaarheid.

{{#if requestNewAppointmentLink}}
Andere tijd aanvragen: {{requestNewAppointmentLink}}
{{/if}}

Als u vragen heeft of hulp nodig heeft bij het vinden van een beschikbaar tijdslot, aarzel dan niet om contact met ons op te nemen via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}. Ons team helpt u graag bij het vinden van een geschikte tijd.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'nl',
      subject: 'Nieuw afspraakverzoek - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nieuw afspraakverzoek</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Nieuw afspraakverzoek</h1>
      <p>Actie vereist</p>
      {{#if isUrgent}}
      <span class="badge">URGENT</span>
      {{/if}}
    </div>

    <div class="content">
      <p class="greeting">Hallo,</p>

      <p class="message">
        Er is een nieuw afspraakverzoek ingediend dat uw beoordeling vereist.
      </p>

      <div class="details-box">
        <h3>Verzoekdetails</h3>
        <div class="detail-row">
          <span class="detail-label">Klant:</span>
          <span class="detail-value">{{clientName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Aanvrager:</span>
          <span class="detail-value">{{requesterName}}</span>
        </div>
        {{#if requesterEmail}}
        <div class="detail-row">
          <span class="detail-label">E-mail:</span>
          <span class="detail-value">{{requesterEmail}}</span>
        </div>
        {{/if}}
        {{#if requesterPhone}}
        <div class="detail-row">
          <span class="detail-label">Telefoon:</span>
          <span class="detail-value">{{requesterPhone}}</span>
        </div>
        {{/if}}
        <div class="detail-row">
          <span class="detail-label">Dienst:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde datum:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gevraagde tijd:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duur:</span>
          <span class="detail-value">{{duration}} minuten</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Voorkeurstechnicus:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if notes}}
      <div class="info-box">
        <p><strong>Klantnotities:</strong></p>
        <p>{{notes}}</p>
      </div>
      {{/if}}

      <div style="text-align: center; margin: 24px 0;">
        <a href="{{reviewLink}}" class="action-button">Beoordelen en reageren</a>
      </div>

      <p class="message" style="text-align: center; color: #64748b; font-size: 14px;">
        Verzoekreferentie: {{referenceNumber}}
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Nieuw afspraakverzoek

Er is een nieuw afspraakverzoek ingediend dat uw beoordeling vereist.

VERZOEKDETAILS:
Klant: {{clientName}}
Aanvrager: {{requesterName}}
{{#if requesterEmail}}E-mail: {{requesterEmail}}{{/if}}
{{#if requesterPhone}}Telefoon: {{requesterPhone}}{{/if}}
Dienst: {{serviceName}}
Gevraagde datum: {{requestedDate}}
Gevraagde tijd: {{requestedTime}}
Duur: {{duration}} minuten
{{#if preferredTechnician}}Voorkeurstechnicus: {{preferredTechnician}}{{/if}}

{{#if notes}}
KLANTNOTITIES:
{{notes}}
{{/if}}

Verzoekreferentie: {{referenceNumber}}

Beoordelen en reageren: {{reviewLink}}`
    }
  ];

  await insertTemplates(dutchAppointmentTemplates, 'Dutch');
  console.log('✓ Dutch appointment email templates added');

  // Italian appointment templates
  
  console.log('Adding Italian templates...');
  const italianAppointmentTemplates = [
    {
      name: 'appointment-request-received',
      language_code: 'it',
      subject: 'Richiesta di appuntamento ricevuta - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-received'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Richiesta di appuntamento ricevuta</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Richiesta ricevuta</h1>
      <p>Abbiamo ricevuto la tua richiesta di appuntamento</p>
    </div>

    <div class="content">
      <p class="greeting">Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Grazie per aver inviato la tua richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminerà a breve.
      </p>

      <div class="reference-number">
        Riferimento: {{referenceNumber}}
      </div>

      <div class="details-box">
        <h3>Dettagli della richiesta</h3>
        <div class="detail-row">
          <span class="detail-label">Servizio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Data richiesta:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Ora richiesta:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Durata:</span>
          <span class="detail-value">{{duration}} minuti</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Tecnico preferito:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      <div class="info-box">
        <p><strong>Cosa succede ora?</strong></p>
        <p>Il nostro team esaminerà la tua richiesta e confermerà la disponibilità. Riceverai una notifica via email una volta che il tuo appuntamento sarà stato approvato o se sono necessarie modifiche. Di solito rispondiamo entro {{responseTime}}.</p>
      </div>

      <p class="message">
        Se hai domande o desideri apportare modifiche alla tua richiesta, contattaci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Richiesta di appuntamento ricevuta

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Grazie per aver inviato la tua richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminerà a breve.

Numero di riferimento: {{referenceNumber}}

DETTAGLI DELLA RICHIESTA:
Servizio: {{serviceName}}
Data richiesta: {{requestedDate}}
Ora richiesta: {{requestedTime}}
Durata: {{duration}} minuti
{{#if preferredTechnician}}Tecnico preferito: {{preferredTechnician}}{{/if}}

COSA SUCCEDE ORA?
Il nostro team esaminerà la tua richiesta e confermerà la disponibilità. Riceverai una notifica via email una volta che il tuo appuntamento sarà stato approvato o se sono necessarie modifiche. Di solito rispondiamo entro {{responseTime}}.

Se hai domande o desideri apportare modifiche alla tua richiesta, contattaci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.`
    },
    {
      name: 'appointment-request-approved',
      language_code: 'it',
      subject: 'Appuntamento confermato - {{serviceName}} il {{appointmentDate}}',
      notification_subtype_id: getSubtypeId('appointment-request-approved'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appuntamento confermato</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Appuntamento confermato</h1>
      <p>Il tuo appuntamento è stato approvato</p>
    </div>

    <div class="content">
      <p class="greeting">Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Ottime notizie! La tua richiesta di appuntamento è stata approvata e confermata. Non vediamo l'ora di servirti.
      </p>

      <div class="appointment-box">
        <h3>Il tuo appuntamento</h3>
        <div class="appointment-detail">
          <strong>Servizio</strong>
          <span>{{serviceName}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Data</strong>
          <span>{{appointmentDate}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Ora</strong>
          <span>{{appointmentTime}}</span>
        </div>
        <div class="appointment-detail">
          <strong>Durata</strong>
          <span>{{duration}} minuti</span>
        </div>
      </div>

      {{#if technicianName}}
      <div class="technician-box">
        <h4>Tecnico assegnato</h4>
        <p class="technician-info">
          <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>Email: {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>Telefono: {{technicianPhone}}{{/if}}
        </p>
      </div>
      {{/if}}

      {{#if calendarLink}}
      <div style="text-align: center; margin: 24px 0;">
        <a href="{{calendarLink}}" class="action-button">Aggiungi al calendario</a>
      </div>
      {{/if}}

      {{#if cancellationPolicy}}
      <div class="policy-box">
        <h4>Politica di cancellazione</h4>
        <p>{{cancellationPolicy}}</p>
      </div>
      {{/if}}

      <p class="message">
        Se devi riprogrammare o annullare questo appuntamento, ti preghiamo di contattarci con almeno {{minimumNoticeHours}} ore di anticipo all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.
      </p>

      <p class="message">
        Ti invieremo un promemoria prima del tuo appuntamento. A presto!
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Appuntamento confermato

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Ottime notizie! La tua richiesta di appuntamento è stata approvata e confermata. Non vediamo l'ora di servirti.

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

{{#if calendarLink}}
Aggiungi al calendario: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
POLITICA DI CANCELLAZIONE:
{{cancellationPolicy}}
{{/if}}

Se devi riprogrammare o annullare questo appuntamento, ti preghiamo di contattarci con almeno {{minimumNoticeHours}} ore di anticipo all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.

Ti invieremo un promemoria prima del tuo appuntamento. A presto!`
    },
    {
      name: 'appointment-request-declined',
      language_code: 'it',
      subject: 'Aggiornamento richiesta di appuntamento - {{serviceName}}',
      notification_subtype_id: getSubtypeId('appointment-request-declined'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aggiornamento richiesta di appuntamento</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Aggiornamento richiesta</h1>
      <p>Riguardo alla tua recente richiesta di appuntamento</p>
    </div>

    <div class="content">
      <p class="greeting">Ciao{{#if requesterName}} {{requesterName}}{{/if}},</p>

      <p class="message">
        Grazie per il tuo interesse nel fissare un appuntamento con noi. Sfortunatamente, non siamo in grado di accogliere la tua richiesta all'orario richiesto.
      </p>

      <div class="details-box">
        <h3>Richiesta originale</h3>
        <div class="detail-row">
          <span class="detail-label">Servizio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Data richiesta:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Ora richiesta:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Riferimento:</span>
          <span class="detail-value">{{referenceNumber}}</span>
        </div>
      </div>

      {{#if declineReason}}
      <div class="reason-box">
        <h4>Motivo</h4>
        <p>{{declineReason}}</p>
      </div>
      {{/if}}

      <div class="action-box">
        <h4>Saremo felici di aiutarti</h4>
        <p>Ci scusiamo per l'inconveniente. Ti invitiamo a inviare una nuova richiesta per una data e un'ora alternative che si adattino meglio alla nostra disponibilità.</p>
        {{#if requestNewAppointmentLink}}
        <a href="{{requestNewAppointmentLink}}" class="action-button">Richiedi altro orario</a>
        {{/if}}
      </div>

      <p class="message">
        Se hai domande o desideri assistenza per trovare una fascia oraria disponibile, non esitare a contattarci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}. Il nostro team è qui per aiutarti a trovare un orario che funzioni per te.
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Aggiornamento richiesta di appuntamento

Ciao{{#if requesterName}} {{requesterName}}{{/if}},

Grazie per il tuo interesse nel fissare un appuntamento con noi. Sfortunatamente, non siamo in grado di accogliere la tua richiesta all'orario richiesto.

RICHIESTA ORIGINALE:
Servizio: {{serviceName}}
Data richiesta: {{requestedDate}}
Ora richiesta: {{requestedTime}}
Riferimento: {{referenceNumber}}

{{#if declineReason}}
MOTIVO:
{{declineReason}}
{{/if}}

SAREMO FELICI DI AIUTARTI
Ci scusiamo per l'inconveniente. Ti invitiamo a inviare una nuova richiesta per una data e un'ora alternative che si adattino meglio alla nostra disponibilità.

{{#if requestNewAppointmentLink}}
Richiedi altro orario: {{requestNewAppointmentLink}}
{{/if}}

Se hai domande o desideri assistenza per trovare una fascia oraria disponibile, non esitare a contattarci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}. Il nostro team è qui per aiutarti a trovare un orario che funzioni per te.`
    },
    {
      name: 'new-appointment-request',
      language_code: 'it',
      subject: 'Nuova richiesta di appuntamento - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
      notification_subtype_id: getSubtypeId('new-appointment-request'),
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nuova richiesta di appuntamento</title>
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
    .badge {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
    }
    .urgent-badge {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
      margin: 16px 0;
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
      <h1>Nuova richiesta di appuntamento</h1>
      <p>Azione richiesta</p>
      {{#if isUrgent}}
      <span class="badge">URGENTE</span>
      {{/if}}
    </div>

    <div class="content">
      <p class="greeting">Ciao,</p>

      <p class="message">
        È stata inviata una nuova richiesta di appuntamento che richiede la tua revisione.
      </p>

      <div class="details-box">
        <h3>Dettagli della richiesta</h3>
        <div class="detail-row">
          <span class="detail-label">Cliente:</span>
          <span class="detail-value">{{clientName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Richiedente:</span>
          <span class="detail-value">{{requesterName}}</span>
        </div>
        {{#if requesterEmail}}
        <div class="detail-row">
          <span class="detail-label">Email:</span>
          <span class="detail-value">{{requesterEmail}}</span>
        </div>
        {{/if}}
        {{#if requesterPhone}}
        <div class="detail-row">
          <span class="detail-label">Telefono:</span>
          <span class="detail-value">{{requesterPhone}}</span>
        </div>
        {{/if}}
        <div class="detail-row">
          <span class="detail-label">Servizio:</span>
          <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Data richiesta:</span>
          <span class="detail-value">{{requestedDate}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Ora richiesta:</span>
          <span class="detail-value">{{requestedTime}}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Durata:</span>
          <span class="detail-value">{{duration}} minuti</span>
        </div>
        {{#if preferredTechnician}}
        <div class="detail-row">
          <span class="detail-label">Tecnico preferito:</span>
          <span class="detail-value">{{preferredTechnician}}</span>
        </div>
        {{/if}}
      </div>

      {{#if notes}}
      <div class="info-box">
        <p><strong>Note del cliente:</strong></p>
        <p>{{notes}}</p>
      </div>
      {{/if}}

      <div style="text-align: center; margin: 24px 0;">
        <a href="{{reviewLink}}" class="action-button">Rivedi e rispondi</a>
      </div>

      <p class="message" style="text-align: center; color: #64748b; font-size: 14px;">
        Riferimento richiesta: {{referenceNumber}}
      </p>
    </div>

    
  </div>
</body>
</html>
      `,
      text_content: `Nuova richiesta di appuntamento

È stata inviata una nuova richiesta di appuntamento che richiede la tua revisione.

DETTAGLI DELLA RICHIESTA:
Cliente: {{clientName}}
Richiedente: {{requesterName}}
{{#if requesterEmail}}Email: {{requesterEmail}}{{/if}}
{{#if requesterPhone}}Telefono: {{requesterPhone}}{{/if}}
Servizio: {{serviceName}}
Data richiesta: {{requestedDate}}
Ora richiesta: {{requestedTime}}
Durata: {{duration}} minuti
{{#if preferredTechnician}}Tecnico preferito: {{preferredTechnician}}{{/if}}

{{#if notes}}
NOTE DEL CLIENTE:
{{notes}}
{{/if}}

Riferimento richiesta: {{referenceNumber}}

Rivedi e rispondi: {{reviewLink}}`
    }
  ];

  await insertTemplates(italianAppointmentTemplates, 'Italian');
  console.log('✓ Italian appointment email templates added');

  console.log('✓ All styled multi-language email templates added including appointments (French, Spanish, German, Dutch, Italian)');
};