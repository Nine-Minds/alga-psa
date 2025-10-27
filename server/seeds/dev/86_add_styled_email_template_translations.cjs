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
    'Comment': 'Commentaire'
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
    'Comment': 'Comentario'
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
    'Comment': 'Kommentar'
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
    'Comment': 'Reactie'
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
    'payment-overdue': 'Paiement en retard : {{invoice.number}}'
  },
  es: {
    'ticket-created': 'Nuevo ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket asignado: {{ticket.title}}',
    'ticket-updated': 'Ticket actualizado: {{ticket.title}}',
    'ticket-closed': 'Ticket cerrado: {{ticket.title}}',
    'ticket-comment-added': 'Nuevo comentario: {{ticket.title}}',
    'invoice-generated': 'Nueva factura {{invoice.number}}',
    'payment-received': 'Pago recibido: {{invoice.number}}',
    'payment-overdue': 'Pago vencido: {{invoice.number}}'
  },
  de: {
    'ticket-created': 'Neues Ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket zugewiesen: {{ticket.title}}',
    'ticket-updated': 'Ticket aktualisiert: {{ticket.title}}',
    'ticket-closed': 'Ticket geschlossen: {{ticket.title}}',
    'ticket-comment-added': 'Neuer Kommentar: {{ticket.title}}',
    'invoice-generated': 'Neue Rechnung {{invoice.number}}',
    'payment-received': 'Zahlung eingegangen: {{invoice.number}}',
    'payment-overdue': 'Zahlung überfällig: {{invoice.number}}'
  },
  nl: {
    'ticket-created': 'Nieuw ticket • {{ticket.title}} ({{ticket.priority}})',
    'ticket-assigned': 'Ticket toegewezen: {{ticket.title}}',
    'ticket-updated': 'Ticket bijgewerkt: {{ticket.title}}',
    'ticket-closed': 'Ticket gesloten: {{ticket.title}}',
    'ticket-comment-added': 'Nieuwe reactie: {{ticket.title}}',
    'invoice-generated': 'Nieuwe factuur {{invoice.number}}',
    'payment-received': 'Betaling ontvangen: {{invoice.number}}',
    'payment-overdue': 'Betaling achterstallig: {{invoice.number}}'
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
    'payment-overdue'
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
