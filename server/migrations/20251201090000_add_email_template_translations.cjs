/**
 * Add multi-language email templates by reading existing English templates
 * and translating only the text content while preserving HTML structure and styling.
 *
 * This migration uses the smart translation approach:
 * 1. Reads existing English templates from database
 * 2. Translates only text content using word replacement
 * 3. Preserves all HTML structure, inline styles, and table-based layouts
 */

// Translation dictionaries for text replacement
const translations = {
  fr: {
    // Common UI elements
    'New Ticket Created': 'Nouveau ticket créé',
    'Ticket Assigned': 'Ticket assigné',
    'Ticket Updated': 'Ticket mis à jour',
    'Ticket Closed': 'Ticket clôturé',
    'New Comment': 'Nouveau commentaire',
    'New Invoice': 'Nouvelle facture',
    'Payment Received': 'Paiement reçu',
    'Payment Overdue': 'Paiement en retard',

    // Ticket details
    'A new ticket has been logged for': 'Un nouveau ticket a été créé pour',
    'Review the summary below and follow the link to take action.': 'Consultez le résumé ci-dessous et suivez le lien pour agir.',
    'You have been assigned to a ticket': 'Un ticket vous a été assigné',
    'A ticket has been updated': 'Un ticket a été mis à jour',
    'A ticket has been closed': 'Un ticket a été clôturé',

    // Labels
    'Ticket': 'Ticket',
    'Priority': 'Priorité',
    'Status': 'Statut',
    'Created': 'Créé',
    'Assigned To': 'Assigné à',
    'Requester': 'Demandeur',
    'Board': 'Tableau',
    'Category': 'Catégorie',
    'Location': 'Lieu',
    'Description': 'Description',
    'Changes': 'Modifications',
    'Updated By': 'Mis à jour par',
    'Closed By': 'Clôturé par',
    'Resolution': 'Résolution',

    // Actions
    'View Ticket': 'Voir le ticket',
    'View Invoice': 'Voir la facture',

    // Invoice/Payment
    'An invoice has been generated for': 'Une facture a été émise pour',
    'Amount': 'Montant',
    'Due Date': 'Échéance',
    'Payment has been received for invoice': 'Le paiement a été reçu pour la facture',
    'Amount Paid': 'Montant payé',
    'Payment Date': 'Date de paiement',
    'Payment Method': 'Méthode de paiement',
    'Payment is overdue for invoice': 'Le paiement est en retard pour la facture',
    'Amount Due': 'Montant dû',
    'Days Overdue': 'Jours de retard',

    // Footer
    'Powered by Alga PSA': 'Propulsé par Alga PSA',
    'Keeping teams aligned': 'Gardez vos équipes alignées',

    // Comments
    'added a comment': 'a ajouté un commentaire',
    'Comment': 'Commentaire',

    // Authentication emails
    'Verify your email': 'Vérifiez votre adresse e-mail',
    'Email Verification': 'Vérification d\'email',
    'Please verify your email address by clicking the link below': 'Veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous',
    'Verify Email': 'Vérifier l\'email',
    'Or copy and paste this link into your browser': 'Ou copiez et collez ce lien dans votre navigateur',
    'This link will expire in': 'Ce lien expirera dans',
    'If you didn\'t request this email, please ignore it': 'Si vous n\'avez pas demandé cet email, veuillez l\'ignorer',

    'Password Reset Request': 'Demande de réinitialisation du mot de passe',
    'Password Reset': 'Réinitialisation du mot de passe',
    'You requested to reset your password': 'Vous avez demandé à réinitialiser votre mot de passe',
    'Click the link below to proceed': 'Cliquez sur le lien ci-dessous pour continuer',
    'Reset Password': 'Réinitialiser le mot de passe',
    'If you didn\'t request this password reset, please ignore this email': 'Si vous n\'avez pas demandé cette réinitialisation, veuillez ignorer cet email',
    'Your password will remain unchanged': 'Votre mot de passe restera inchangé',
    'Need help': 'Besoin d\'aide',

    'Portal Invitation': 'Invitation au portail',
    'Welcome to Your Customer Portal': 'Bienvenue sur votre portail client',
    'You are invited to access the': 'Vous êtes invité à accéder au portail client de',
    'customer portal': 'portail client',
    'Activate Your Access': 'Activer votre accès',
    'Need assistance': 'Besoin d\'assistance',

    'Credits Expiring Soon': 'Crédits expirant bientôt',
    'Your prepaid service credits will expire soon': 'Vos crédits de service prépayés expireront bientôt',
    'Remaining Credits': 'Crédits restants',
    'Expiration Date': 'Date d\'expiration',
    'View Credits': 'Voir les crédits'
  },
  es: {
    'New Ticket Created': 'Nuevo ticket creado',
    'Ticket Assigned': 'Ticket asignado',
    'Ticket Updated': 'Ticket actualizado',
    'Ticket Closed': 'Ticket cerrado',
    'New Comment': 'Nuevo comentario',
    'New Invoice': 'Nueva factura',
    'Payment Received': 'Pago recibido',
    'Payment Overdue': 'Pago vencido',

    'A new ticket has been logged for': 'Se ha creado un nuevo ticket para',
    'Review the summary below and follow the link to take action.': 'Revise el resumen a continuación y siga el enlace para actuar.',
    'You have been assigned to a ticket': 'Se le ha asignado un ticket',
    'A ticket has been updated': 'Se ha actualizado un ticket',
    'A ticket has been closed': 'Se ha cerrado un ticket',

    'Ticket': 'Ticket',
    'Priority': 'Prioridad',
    'Status': 'Estado',
    'Created': 'Creado',
    'Assigned To': 'Asignado a',
    'Requester': 'Solicitante',
    'Board': 'Tablero',
    'Category': 'Categoría',
    'Location': 'Ubicación',
    'Description': 'Descripción',
    'Changes': 'Cambios',
    'Updated By': 'Actualizado por',
    'Closed By': 'Cerrado por',
    'Resolution': 'Resolución',

    'View Ticket': 'Ver ticket',
    'View Invoice': 'Ver factura',

    'An invoice has been generated for': 'Se ha emitido una factura para',
    'Amount': 'Importe',
    'Due Date': 'Vence',
    'Payment has been received for invoice': 'Se ha recibido un pago para la factura',
    'Amount Paid': 'Importe pagado',
    'Payment Date': 'Fecha de pago',
    'Payment Method': 'Método',
    'Payment is overdue for invoice': 'El pago está vencido para la factura',
    'Amount Due': 'Importe adeudado',
    'Days Overdue': 'Días de atraso',

    'Powered by Alga PSA': 'Desarrollado por Alga PSA',
    'Keeping teams aligned': 'Manteniendo equipos alineados',

    'added a comment': 'añadió un comentario',
    'Comment': 'Comentario',

    // Authentication emails
    'Verify your email': 'Verifica tu correo electrónico',
    'Email Verification': 'Verificación de correo',
    'Please verify your email address by clicking the link below': 'Verifica tu dirección de correo haciendo clic en el enlace',
    'Verify Email': 'Verificar correo',
    'Or copy and paste this link into your browser': 'O copia y pega este enlace en tu navegador',
    'This link will expire in': 'Este enlace expirará en',
    'If you didn\'t request this email, please ignore it': 'Si no solicitaste este correo, ignóralo',

    'Password Reset Request': 'Solicitud de restablecimiento de contraseña',
    'Password Reset': 'Restablecer contraseña',
    'You requested to reset your password': 'Solicitaste restablecer tu contraseña',
    'Click the link below to proceed': 'Haz clic en el enlace para continuar',
    'Reset Password': 'Restablecer contraseña',
    'If you didn\'t request this password reset, please ignore this email': 'Si no solicitaste este restablecimiento, ignora este correo',
    'Your password will remain unchanged': 'Tu contraseña permanecerá sin cambios',
    'Need help': 'Necesitas ayuda',

    'Portal Invitation': 'Invitación al portal',
    'Welcome to Your Customer Portal': 'Bienvenido a tu portal de clientes',
    'You are invited to access the': 'Has sido invitado a acceder al portal de clientes de',
    'customer portal': 'portal de clientes',
    'Activate Your Access': 'Activar acceso',
    'Need assistance': 'Necesitas asistencia',

    'Credits Expiring Soon': 'Créditos por expirar',
    'Your prepaid service credits will expire soon': 'Tus créditos de servicio prepago expirarán pronto',
    'Remaining Credits': 'Créditos restantes',
    'Expiration Date': 'Fecha de expiración',
    'View Credits': 'Ver créditos'
  },
  de: {
    'New Ticket Created': 'Neues Ticket erstellt',
    'Ticket Assigned': 'Ticket zugewiesen',
    'Ticket Updated': 'Ticket aktualisiert',
    'Ticket Closed': 'Ticket geschlossen',
    'New Comment': 'Neuer Kommentar',
    'New Invoice': 'Neue Rechnung',
    'Payment Received': 'Zahlung eingegangen',
    'Payment Overdue': 'Zahlung überfällig',

    'A new ticket has been logged for': 'Ein neues Ticket wurde erstellt für',
    'Review the summary below and follow the link to take action.': 'Überprüfen Sie die Zusammenfassung unten und folgen Sie dem Link.',
    'You have been assigned to a ticket': 'Ihnen wurde ein Ticket zugewiesen',
    'A ticket has been updated': 'Ein Ticket wurde aktualisiert',
    'A ticket has been closed': 'Ein Ticket wurde geschlossen',

    'Ticket': 'Ticket',
    'Priority': 'Priorität',
    'Status': 'Status',
    'Created': 'Erstellt',
    'Assigned To': 'Zugewiesen an',
    'Requester': 'Anfragender',
    'Board': 'Board',
    'Category': 'Kategorie',
    'Location': 'Standort',
    'Description': 'Beschreibung',
    'Changes': 'Änderungen',
    'Updated By': 'Aktualisiert von',
    'Closed By': 'Geschlossen von',
    'Resolution': 'Lösung',

    'View Ticket': 'Ticket anzeigen',
    'View Invoice': 'Rechnung anzeigen',

    'An invoice has been generated for': 'Eine Rechnung wurde erstellt für',
    'Amount': 'Betrag',
    'Due Date': 'Fällig am',
    'Payment has been received for invoice': 'Zahlung eingegangen für Rechnung',
    'Amount Paid': 'Bezahlter Betrag',
    'Payment Date': 'Zahlungsdatum',
    'Payment Method': 'Zahlungsmethode',
    'Payment is overdue for invoice': 'Zahlung überfällig für Rechnung',
    'Amount Due': 'Offener Betrag',
    'Days Overdue': 'Tage überfällig',

    'Powered by Alga PSA': 'Betrieben von Alga PSA',
    'Keeping teams aligned': 'Teams ausgerichtet halten',

    'added a comment': 'hat einen Kommentar hinzugefügt',
    'Comment': 'Kommentar',

    // Authentication emails
    'Verify your email': 'Bestätigen Sie Ihre E-Mail',
    'Email Verification': 'E-Mail-Bestätigung',
    'Please verify your email address by clicking the link below': 'Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie auf den Link klicken',
    'Verify Email': 'E-Mail bestätigen',
    'Or copy and paste this link into your browser': 'Oder kopieren Sie diesen Link in Ihren Browser',
    'This link will expire in': 'Dieser Link läuft ab in',
    'If you didn\'t request this email, please ignore it': 'Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie bitte',

    'Password Reset Request': 'Anfrage zum Zurücksetzen des Passworts',
    'Password Reset': 'Passwort zurücksetzen',
    'You requested to reset your password': 'Sie haben das Zurücksetzen Ihres Passworts angefordert',
    'Click the link below to proceed': 'Klicken Sie auf den Link, um fortzufahren',
    'Reset Password': 'Passwort zurücksetzen',
    'If you didn\'t request this password reset, please ignore this email': 'Wenn Sie dieses Zurücksetzen nicht angefordert haben, ignorieren Sie diese E-Mail',
    'Your password will remain unchanged': 'Ihr Passwort bleibt unverändert',
    'Need help': 'Brauchen Sie Hilfe',

    'Portal Invitation': 'Portaleinladung',
    'Welcome to Your Customer Portal': 'Willkommen in Ihrem Kundenportal',
    'You are invited to access the': 'Sie sind eingeladen, auf das Kundenportal von',
    'customer portal': 'Kundenportal',
    'Activate Your Access': 'Zugang aktivieren',
    'Need assistance': 'Benötigen Sie Hilfe',

    'Credits Expiring Soon': 'Guthaben läuft bald ab',
    'Your prepaid service credits will expire soon': 'Ihr Prepaid-Serviceguthaben läuft bald ab',
    'Remaining Credits': 'Verbleibendes Guthaben',
    'Expiration Date': 'Ablaufdatum',
    'View Credits': 'Guthaben anzeigen'
  },
  nl: {
    'New Ticket Created': 'Nieuw ticket aangemaakt',
    'Ticket Assigned': 'Ticket toegewezen',
    'Ticket Updated': 'Ticket bijgewerkt',
    'Ticket Closed': 'Ticket gesloten',
    'New Comment': 'Nieuwe reactie',
    'New Invoice': 'Nieuwe factuur',
    'Payment Received': 'Betaling ontvangen',
    'Payment Overdue': 'Betaling achterstallig',

    'A new ticket has been logged for': 'Er is een nieuw ticket aangemaakt voor',
    'Review the summary below and follow the link to take action.': 'Bekijk de samenvatting hieronder en volg de link om actie te ondernemen.',
    'You have been assigned to a ticket': 'U heeft een ticket toegewezen gekregen',
    'A ticket has been updated': 'Een ticket is bijgewerkt',
    'A ticket has been closed': 'Een ticket is gesloten',

    'Ticket': 'Ticket',
    'Priority': 'Prioriteit',
    'Status': 'Status',
    'Created': 'Aangemaakt',
    'Assigned To': 'Toegewezen aan',
    'Requester': 'Aanvrager',
    'Board': 'Bord',
    'Category': 'Categorie',
    'Location': 'Locatie',
    'Description': 'Beschrijving',
    'Changes': 'Wijzigingen',
    'Updated By': 'Bijgewerkt door',
    'Closed By': 'Gesloten door',
    'Resolution': 'Oplossing',

    'View Ticket': 'Bekijk ticket',
    'View Invoice': 'Bekijk factuur',

    'An invoice has been generated for': 'Er is een factuur gemaakt voor',
    'Amount': 'Bedrag',
    'Due Date': 'Vervaldatum',
    'Payment has been received for invoice': 'Betaling ontvangen voor factuur',
    'Amount Paid': 'Betaald bedrag',
    'Payment Date': 'Betaaldatum',
    'Payment Method': 'Betalingsmethode',
    'Payment is overdue for invoice': 'Betaling is achterstallig voor factuur',
    'Amount Due': 'Openstaand bedrag',
    'Days Overdue': 'Dagen te laat',

    'Powered by Alga PSA': 'Mogelijk gemaakt door Alga PSA',
    'Keeping teams aligned': 'Teams op één lijn houden',

    'added a comment': 'heeft een reactie geplaatst',
    'Comment': 'Reactie',

    // Authentication emails
    'Verify your email': 'Bevestig je e-mailadres',
    'Email Verification': 'E-mailverificatie',
    'Please verify your email address by clicking the link below': 'Bevestig je e-mailadres door op de link te klikken',
    'Verify Email': 'E-mail bevestigen',
    'Or copy and paste this link into your browser': 'Of kopieer en plak deze link in je browser',
    'This link will expire in': 'Deze link verloopt over',
    'If you didn\'t request this email, please ignore it': 'Als je deze e-mail niet hebt aangevraagd, negeer hem dan',

    'Password Reset Request': 'Verzoek om wachtwoord te resetten',
    'Password Reset': 'Wachtwoord resetten',
    'You requested to reset your password': 'Je hebt gevraagd om je wachtwoord te resetten',
    'Click the link below to proceed': 'Klik op de link om door te gaan',
    'Reset Password': 'Wachtwoord resetten',
    'If you didn\'t request this password reset, please ignore this email': 'Als je dit resetten niet hebt aangevraagd, negeer deze e-mail dan',
    'Your password will remain unchanged': 'Je wachtwoord blijft ongewijzigd',
    'Need help': 'Hulp nodig',

    'Portal Invitation': 'Portaluitnodiging',
    'Welcome to Your Customer Portal': 'Welkom bij je klantenportaal',
    'You are invited to access the': 'Je bent uitgenodigd om toegang te krijgen tot het klantenportaal van',
    'customer portal': 'klantenportaal',
    'Activate Your Access': 'Toegang activeren',
    'Need assistance': 'Hulp nodig',

    'Credits Expiring Soon': 'Tegoed verloopt binnenkort',
    'Your prepaid service credits will expire soon': 'Je prepaid servicetegoed verloopt binnenkort',
    'Remaining Credits': 'Resterend tegoed',
    'Expiration Date': 'Vervaldatum',
    'View Credits': 'Bekijk tegoed'
  }
};

// Subject translations - these are complete subject lines
const subjectTranslations = {
  fr: {
    'ticket-created': 'Nouveau ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket assigné : {{ticket.title}}',
    'ticket-updated': 'Ticket mis à jour : {{ticket.title}}',
    'ticket-closed': 'Ticket clôturé : {{ticket.title}}',
    'ticket-comment-added': 'Nouveau commentaire : {{ticket.title}}',
    'invoice-generated': 'Nouvelle facture {{invoice.number}}',
    'payment-received': 'Paiement reçu : {{invoice.number}}',
    'payment-overdue': 'Paiement en retard : {{invoice.number}}',
    'email-verification': 'Vérifiez votre adresse e-mail{{#if registrationCompanyName}} pour {{registrationCompanyName}}{{/if}}',
    'password-reset': 'Demande de réinitialisation du mot de passe',
    'portal-invitation': 'Invitation au portail client - {{clientName}}',
    'credits-expiring': 'Crédits expirant bientôt : {{company.name}}'
  },
  es: {
    'ticket-created': 'Nuevo ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket asignado: {{ticket.title}}',
    'ticket-updated': 'Ticket actualizado: {{ticket.title}}',
    'ticket-closed': 'Ticket cerrado: {{ticket.title}}',
    'ticket-comment-added': 'Nuevo comentario: {{ticket.title}}',
    'invoice-generated': 'Nueva factura {{invoice.number}}',
    'payment-received': 'Pago recibido: {{invoice.number}}',
    'payment-overdue': 'Pago vencido: {{invoice.number}}',
    'email-verification': 'Verifica tu correo electrónico{{#if registrationCompanyName}} para {{registrationCompanyName}}{{/if}}',
    'password-reset': 'Solicitud de restablecimiento de contraseña',
    'portal-invitation': 'Invitación al portal de clientes - {{clientName}}',
    'credits-expiring': 'Créditos por expirar: {{company.name}}'
  },
  de: {
    'ticket-created': 'Neues Ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket zugewiesen: {{ticket.title}}',
    'ticket-updated': 'Ticket aktualisiert: {{ticket.title}}',
    'ticket-closed': 'Ticket geschlossen: {{ticket.title}}',
    'ticket-comment-added': 'Neuer Kommentar: {{ticket.title}}',
    'invoice-generated': 'Neue Rechnung {{invoice.number}}',
    'payment-received': 'Zahlung eingegangen: {{invoice.number}}',
    'payment-overdue': 'Zahlung überfällig: {{invoice.number}}',
    'email-verification': 'Bestätigen Sie Ihre E-Mail-Adresse{{#if registrationCompanyName}} für {{registrationCompanyName}}{{/if}}',
    'password-reset': 'Anfrage zum Zurücksetzen des Passworts',
    'portal-invitation': 'Einladung zum Kundenportal - {{clientName}}',
    'credits-expiring': 'Guthaben läuft bald ab: {{company.name}}'
  },
  nl: {
    'ticket-created': 'Nieuw ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket toegewezen: {{ticket.title}}',
    'ticket-updated': 'Ticket bijgewerkt: {{ticket.title}}',
    'ticket-closed': 'Ticket gesloten: {{ticket.title}}',
    'ticket-comment-added': 'Nieuwe reactie: {{ticket.title}}',
    'invoice-generated': 'Nieuwe factuur {{invoice.number}}',
    'payment-received': 'Betaling ontvangen: {{invoice.number}}',
    'payment-overdue': 'Betaling achterstallig: {{invoice.number}}',
    'email-verification': 'Bevestig je e-mailadres{{#if registrationCompanyName}} voor {{registrationCompanyName}}{{/if}}',
    'password-reset': 'Verzoek om wachtwoord te resetten',
    'portal-invitation': 'Uitnodiging voor het klantenportaal - {{clientName}}',
    'credits-expiring': 'Tegoed verloopt binnenkort: {{company.name}}'
  }
};

/**
 * Translate text content while preserving HTML structure and template variables
 */
function translateContent(content, dictionary) {
  if (!content) return content;

  let translated = content;

  // Replace text while preserving template variables {{...}}
  for (const [english, translation] of Object.entries(dictionary)) {
    // Use word boundaries and case-sensitive replacement
    const regex = new RegExp(`\\b${english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    translated = translated.replace(regex, translation);
  }

  return translated;
}

/**
 * Create translated templates from English templates
 */
async function createTranslatedTemplates(knex) {
  const templatesToTranslate = [
    'ticket-created',
    'ticket-assigned',
    'ticket-updated',
    'ticket-closed',
    'ticket-comment-added',
    'invoice-generated',
    'payment-received',
    'payment-overdue',
    'email-verification',
    'password-reset',
    'portal-invitation',
    'credits-expiring'
  ];

  for (const templateName of templatesToTranslate) {
    // Get English template
    const englishTemplate = await knex('system_email_templates')
      .where({ name: templateName, language_code: 'en' })
      .first();

    if (!englishTemplate) {
      console.warn(`Skipping ${templateName} - English template not found`);
      continue;
    }

    // Create translations for each language
    for (const [langCode, dictionary] of Object.entries(translations)) {
      const translatedHtml = translateContent(englishTemplate.html_content, dictionary);
      const translatedText = translateContent(englishTemplate.text_content, dictionary);
      const translatedSubject = subjectTranslations[langCode][templateName] || englishTemplate.subject;

      // Upsert translated template
      await knex('system_email_templates')
        .insert({
          name: templateName,
          language_code: langCode,
          subject: translatedSubject,
          html_content: translatedHtml,
          text_content: translatedText,
          notification_subtype_id: englishTemplate.notification_subtype_id
        })
        .onConflict(['name', 'language_code'])
        .merge({
          subject: knex.raw('excluded.subject'),
          html_content: knex.raw('excluded.html_content'),
          text_content: knex.raw('excluded.text_content'),
          notification_subtype_id: knex.raw('excluded.notification_subtype_id'),
          updated_at: knex.fn.now()
        });

      console.log(`✓ Created ${langCode} translation for ${templateName}`);
    }
  }
}

exports.up = async function(knex) {
  console.log('Creating styled multi-language email templates...');
  await createTranslatedTemplates(knex);
  console.log('Done! All translations created with preserved styling.');
};

exports.down = async function(knex) {
  const languages = Object.keys(translations);
  const templateNames = [
    'ticket-created',
    'ticket-assigned',
    'ticket-updated',
    'ticket-closed',
    'ticket-comment-added',
    'invoice-generated',
    'payment-received',
    'payment-overdue',
    'email-verification',
    'password-reset',
    'portal-invitation',
    'credits-expiring'
  ];

  await knex('system_email_templates')
    .whereIn('language_code', languages)
    .whereIn('name', templateNames)
    .del();

  console.log('Removed translated email templates');
};
