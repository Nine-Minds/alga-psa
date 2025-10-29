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
