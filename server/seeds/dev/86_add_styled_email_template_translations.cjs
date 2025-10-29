/**
 * Add multi-language email templates by reading existing English templates
 * and translating only the text content while preserving HTML structure and styling.
 *
 * This approach ensures:
 * 1. We don't duplicate template structure
 * 2. Translations inherit any styling updates to English templates
 * 3. All templates maintain visual consistency
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

    // Tenant Recovery
    'Your Login Links': 'Vos liens de connexion',
    'Hello,': 'Bonjour,',
    'You requested access to your client portal': 'Vous avez demandé l\'accès à votre portail client',
    'You requested access to your client portals': 'Vous avez demandé l\'accès à vos portails clients',
    'We found': 'Nous avons trouvé',
    'organizations associated with your email address': 'organisations associées à votre adresse e-mail',
    'Here is your login link:': 'Voici votre lien de connexion :',
    'Sign In to': 'Se connecter à',
    'Security Note:': 'Note de sécurité :',
    'If you didn\'t request these login links, you can safely ignore this email. Your account remains secure.': 'Si vous n\'avez pas demandé ces liens de connexion, vous pouvez ignorer cet e-mail en toute sécurité. Votre compte reste sécurisé.',
    'If you have any questions or need assistance, please contact your organization\'s support team.': 'Si vous avez des questions ou besoin d\'assistance, veuillez contacter l\'équipe d\'assistance de votre organisation.',
    'All rights reserved.': 'Tous droits réservés.',
    'This is an automated message. Please do not reply to this email.': 'Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.',

    // No Account Found
    'Access Request': 'Demande d\'accès',
    'We received a request to access the client portal using this email address.': 'Nous avons reçu une demande d\'accès au portail client utilisant cette adresse e-mail.',
    'If you have an account with us, you should have received a separate email with your login links.': 'Si vous avez un compte chez nous, vous devriez avoir reçu un e-mail séparé avec vos liens de connexion.',
    'If you didn\'t receive a login email, it may mean:': 'Si vous n\'avez pas reçu d\'e-mail de connexion, cela peut signifier :',
    'This email address is not associated with any client portal accounts': 'Cette adresse e-mail n\'est associée à aucun compte de portail client',
    'Your account may be inactive': 'Votre compte peut être inactif',
    'The email may have been filtered to your spam folder': 'L\'e-mail peut avoir été filtré vers votre dossier spam',
    'Need Help?': 'Besoin d\'aide ?',
    'If you believe you should have access to a client portal, please contact your service provider\'s support team for assistance.': 'Si vous pensez que vous devriez avoir accès à un portail client, veuillez contacter l\'équipe d\'assistance de votre fournisseur de services pour obtenir de l\'aide.',
    'If you didn\'t request access, you can safely ignore this email.': 'Si vous n\'avez pas demandé d\'accès, vous pouvez ignorer cet e-mail en toute sécurité.'
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

    // Tenant Recovery
    'Your Login Links': 'Tus enlaces de inicio de sesión',
    'Hello,': 'Hola,',
    'You requested access to your client portal': 'Solicitaste acceso a tu portal de cliente',
    'You requested access to your client portals': 'Solicitaste acceso a tus portales de clientes',
    'We found': 'Encontramos',
    'organizations associated with your email address': 'organizaciones asociadas con tu dirección de correo electrónico',
    'Here is your login link:': 'Aquí está tu enlace de inicio de sesión:',
    'Sign In to': 'Iniciar sesión en',
    'Security Note:': 'Nota de seguridad:',
    'If you didn\'t request these login links, you can safely ignore this email. Your account remains secure.': 'Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura. Tu cuenta permanece segura.',
    'If you have any questions or need assistance, please contact your organization\'s support team.': 'Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.',
    'All rights reserved.': 'Todos los derechos reservados.',
    'This is an automated message. Please do not reply to this email.': 'Este es un mensaje automático. Por favor no respondas a este correo.',

    // No Account Found
    'Access Request': 'Solicitud de acceso',
    'We received a request to access the client portal using this email address.': 'Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.',
    'If you have an account with us, you should have received a separate email with your login links.': 'Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.',
    'If you didn\'t receive a login email, it may mean:': 'Si no recibiste un correo de inicio de sesión, puede significar:',
    'This email address is not associated with any client portal accounts': 'Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente',
    'Your account may be inactive': 'Tu cuenta puede estar inactiva',
    'The email may have been filtered to your spam folder': 'El correo puede haber sido filtrado a tu carpeta de spam',
    'Need Help?': '¿Necesitas ayuda?',
    'If you believe you should have access to a client portal, please contact your service provider\'s support team for assistance.': 'Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.',
    'If you didn\'t request access, you can safely ignore this email.': 'Si no solicitaste acceso, puedes ignorar este correo de forma segura.'
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

    // Tenant Recovery
    'Your Login Links': 'Ihre Anmeldelinks',
    'Hello,': 'Hallo,',
    'You requested access to your client portal': 'Sie haben Zugang zu Ihrem Kundenportal angefordert',
    'You requested access to your client portals': 'Sie haben Zugang zu Ihren Kundenportalen angefordert',
    'We found': 'Wir haben',
    'organizations associated with your email address': 'Organisationen gefunden, die mit Ihrer E-Mail-Adresse verknüpft sind',
    'Here is your login link:': 'Hier ist Ihr Anmeldelink:',
    'Sign In to': 'Anmelden bei',
    'Security Note:': 'Sicherheitshinweis:',
    'If you didn\'t request these login links, you can safely ignore this email. Your account remains secure.': 'Wenn Sie diese Anmeldelinks nicht angefordert haben, können Sie diese E-Mail sicher ignorieren. Ihr Konto bleibt sicher.',
    'If you have any questions or need assistance, please contact your organization\'s support team.': 'Bei Fragen oder für Unterstützung wenden Sie sich bitte an das Support-Team Ihrer Organisation.',
    'All rights reserved.': 'Alle Rechte vorbehalten.',
    'This is an automated message. Please do not reply to this email.': 'Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.',

    // No Account Found
    'Access Request': 'Zugriffsanfrage',
    'We received a request to access the client portal using this email address.': 'Wir haben eine Anfrage für den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.',
    'If you have an account with us, you should have received a separate email with your login links.': 'Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.',
    'If you didn\'t receive a login email, it may mean:': 'Wenn Sie keine Anmelde-E-Mail erhalten haben, könnte dies bedeuten:',
    'This email address is not associated with any client portal accounts': 'Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verknüpft',
    'Your account may be inactive': 'Ihr Konto könnte inaktiv sein',
    'The email may have been filtered to your spam folder': 'Die E-Mail könnte in Ihrem Spam-Ordner gefiltert worden sein',
    'Need Help?': 'Benötigen Sie Hilfe?',
    'If you believe you should have access to a client portal, please contact your service provider\'s support team for assistance.': 'Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.',
    'If you didn\'t request access, you can safely ignore this email.': 'Wenn Sie keinen Zugriff angefordert haben, können Sie diese E-Mail sicher ignorieren.'
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

    // Tenant Recovery
    'Your Login Links': 'Uw inloglinks',
    'Hello,': 'Hallo,',
    'You requested access to your client portal': 'U heeft toegang aangevraagd tot uw klantenportaal',
    'You requested access to your client portals': 'U heeft toegang aangevraagd tot uw klantenportalen',
    'We found': 'We hebben',
    'organizations associated with your email address': 'organisaties gevonden die gekoppeld zijn aan uw e-mailadres',
    'Here is your login link:': 'Hier is uw inloglink:',
    'Sign In to': 'Inloggen bij',
    'Security Note:': 'Beveiligingsopmerking:',
    'If you didn\'t request these login links, you can safely ignore this email. Your account remains secure.': 'Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren. Uw account blijft beveiligd.',
    'If you have any questions or need assistance, please contact your organization\'s support team.': 'Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.',
    'All rights reserved.': 'Alle rechten voorbehouden.',
    'This is an automated message. Please do not reply to this email.': 'Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.',

    // No Account Found
    'Access Request': 'Toegangsverzoek',
    'We received a request to access the client portal using this email address.': 'We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.',
    'If you have an account with us, you should have received a separate email with your login links.': 'Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.',
    'If you didn\'t receive a login email, it may mean:': 'Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:',
    'This email address is not associated with any client portal accounts': 'Dit e-mailadres is niet gekoppeld aan een klantenportalaccount',
    'Your account may be inactive': 'Uw account kan inactief zijn',
    'The email may have been filtered to your spam folder': 'De e-mail kan zijn gefilterd naar uw spam-map',
    'Need Help?': 'Hulp nodig?',
    'If you believe you should have access to a client portal, please contact your service provider\'s support team for assistance.': 'Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.',
    'If you didn\'t request access, you can safely ignore this email.': 'Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.'
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
    'tenant-recovery': '{{platformName}} - Vos liens de connexion',
    'no-account-found': '{{platformName}} - Demande d\'accès'
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
    'tenant-recovery': '{{platformName}} - Tus enlaces de inicio de sesión',
    'no-account-found': '{{platformName}} - Solicitud de acceso'
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
    'tenant-recovery': '{{platformName}} - Ihre Anmeldelinks',
    'no-account-found': '{{platformName}} - Zugriffsanfrage'
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
    'tenant-recovery': '{{platformName}} - Uw inloglinks',
    'no-account-found': '{{platformName}} - Toegangsverzoek'
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
    'tenant-recovery',
    'no-account-found'
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

exports.seed = async function(knex) {
  console.log('Creating styled multi-language email templates...');
  await createTranslatedTemplates(knex);
  console.log('Done! All translations created.');
};
