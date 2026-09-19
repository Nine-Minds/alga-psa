/**
 * Seed translations for internal notification templates (fr, es, de, nl, it)
 */

exports.up = async function(knex) {
  console.log('Seeding internal notification template translations...');

  const targetLanguages = ['fr', 'es', 'de', 'nl', 'it'];

  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id as id', 'name');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  // Map template names to their corresponding subtype names
  const templateToSubtype = {
    'ticket-created-client': 'ticket-created',
    'ticket-updated-client': 'ticket-updated',
    'ticket-closed-client': 'ticket-closed',
    'ticket-comment-added-client': 'ticket-comment-added',
    'message-sent': 'message-sent',
    'user-mentioned-in-comment': 'user-mentioned',
    'user-mentioned-in-document': 'user-mentioned'
  };

  const translations = {
    fr: {
      'ticket-assigned': {
        title: 'Ticket assigné',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) vous a été assigné par {{performedByName}}'
      },
      'ticket-created-client': {
        title: 'Votre ticket d\'assistance a été créé',
        message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a été créé et notre équipe vous répondra bientôt'
      },
      'ticket-updated-client': {
        title: 'Votre ticket a été mis à jour',
        message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a été mis à jour'
      },
      'ticket-closed-client': {
        title: 'Votre ticket a été fermé',
        message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a été fermé'
      },
      'ticket-comment-added-client': {
        title: 'Nouveau commentaire sur votre ticket',
        message: '{{authorName}} a commenté votre ticket #{{ticketId}}: "{{commentPreview}}"'
      },
      'message-sent': {
        title: 'Nouveau message',
        message: '{{senderName}}: {{messagePreview}}'
      },
      'invoice-generated': {
        title: 'Nouvelle facture générée',
        message: 'La facture #{{invoiceNumber}} pour {{clientName}} a été générée'
      },
      'payment-received': {
        title: 'Paiement reçu',
        message: 'Paiement de {{amount}} reçu pour la facture #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Paiement en retard',
        message: 'La facture #{{invoiceNumber}} est en retard de {{daysOverdue}} jours'
      },
      'user-mentioned-in-comment': {
        title: 'Vous avez été mentionné dans un commentaire',
        message: '{{commentAuthor}} vous a mentionné dans le ticket #{{ticketNumber}}: {{commentPreview}}'
      },
      'user-mentioned-in-document': {
        title: 'Vous avez été mentionné dans un document',
        message: '{{authorName}} vous a mentionné dans le document "{{documentName}}"'
      },
      'ticket-status-changed': {
        title: 'Statut du ticket modifié',
        message: 'Statut du ticket #{{ticketId}} "{{ticketTitle}}" modifié: {{oldStatus}} → {{newStatus}} par {{performedByName}}'
      },
      'ticket-priority-changed': {
        title: 'Priorité du ticket modifiée',
        message: 'Priorité du ticket #{{ticketId}} "{{ticketTitle}}" modifiée: {{oldPriority}} → {{newPriority}} par {{performedByName}}'
      },
      'ticket-reassigned': {
        title: 'Ticket réassigné',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" réassigné: {{oldAssignedTo}} → {{newAssignedTo}} par {{performedByName}}'
      }
    },
    es: {
      'ticket-assigned': {
        title: 'Ticket asignado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) le ha sido asignado por {{performedByName}}'
      },
      'ticket-created-client': {
        title: 'Su ticket de soporte ha sido creado',
        message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido creado y nuestro equipo responderá pronto'
      },
      'ticket-updated-client': {
        title: 'Su ticket ha sido actualizado',
        message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido actualizado'
      },
      'ticket-closed-client': {
        title: 'Su ticket ha sido cerrado',
        message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido cerrado'
      },
      'ticket-comment-added-client': {
        title: 'Nuevo comentario en su ticket',
        message: '{{authorName}} comentó su ticket #{{ticketId}}: "{{commentPreview}}"'
      },
      'message-sent': {
        title: 'Nuevo mensaje',
        message: '{{senderName}}: {{messagePreview}}'
      },
      'invoice-generated': {
        title: 'Nueva factura generada',
        message: 'La factura #{{invoiceNumber}} para {{clientName}} ha sido generada'
      },
      'payment-received': {
        title: 'Pago recibido',
        message: 'Pago de {{amount}} recibido para la factura #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Pago vencido',
        message: 'La factura #{{invoiceNumber}} está vencida desde hace {{daysOverdue}} días'
      },
      'user-mentioned-in-comment': {
        title: 'Te mencionaron en un comentario',
        message: '{{commentAuthor}} te mencionó en el ticket #{{ticketNumber}}: {{commentPreview}}'
      },
      'user-mentioned-in-document': {
        title: 'Te mencionaron en un documento',
        message: '{{authorName}} te mencionó en el documento "{{documentName}}"'
      },
      'ticket-status-changed': {
        title: 'Estado del ticket cambiado',
        message: 'Estado del ticket #{{ticketId}} "{{ticketTitle}}" cambiado: {{oldStatus}} → {{newStatus}} por {{performedByName}}'
      },
      'ticket-priority-changed': {
        title: 'Prioridad del ticket cambiada',
        message: 'Prioridad del ticket #{{ticketId}} "{{ticketTitle}}" cambiada: {{oldPriority}} → {{newPriority}} por {{performedByName}}'
      },
      'ticket-reassigned': {
        title: 'Ticket reasignado',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" reasignado: {{oldAssignedTo}} → {{newAssignedTo}} por {{performedByName}}'
      }
    },
    de: {
      'ticket-assigned': {
        title: 'Ticket zugewiesen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) wurde Ihnen von {{performedByName}} zugewiesen'
      },
      'ticket-created-client': {
        title: 'Ihr Support-Ticket wurde erstellt',
        message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde erstellt und unser Team wird sich in Kürze bei Ihnen melden'
      },
      'ticket-updated-client': {
        title: 'Ihr Ticket wurde aktualisiert',
        message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde aktualisiert'
      },
      'ticket-closed-client': {
        title: 'Ihr Ticket wurde geschlossen',
        message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde geschlossen'
      },
      'ticket-comment-added-client': {
        title: 'Neuer Kommentar zu Ihrem Ticket',
        message: '{{authorName}} hat Ihr Ticket #{{ticketId}} kommentiert: "{{commentPreview}}"'
      },
      'message-sent': {
        title: 'Neue Nachricht',
        message: '{{senderName}}: {{messagePreview}}'
      },
      'invoice-generated': {
        title: 'Neue Rechnung erstellt',
        message: 'Rechnung #{{invoiceNumber}} für {{clientName}} wurde erstellt'
      },
      'payment-received': {
        title: 'Zahlung erhalten',
        message: 'Zahlung von {{amount}} für Rechnung #{{invoiceNumber}} erhalten'
      },
      'payment-overdue': {
        title: 'Zahlung überfällig',
        message: 'Rechnung #{{invoiceNumber}} ist {{daysOverdue}} Tage überfällig'
      },
      'user-mentioned-in-comment': {
        title: 'Sie wurden in einem Kommentar erwähnt',
        message: '{{commentAuthor}} hat Sie im Ticket #{{ticketNumber}} erwähnt: {{commentPreview}}'
      },
      'user-mentioned-in-document': {
        title: 'Sie wurden in einem Dokument erwähnt',
        message: '{{authorName}} hat Sie im Dokument "{{documentName}}" erwähnt'
      },
      'ticket-status-changed': {
        title: 'Ticket-Status geändert',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" Status geändert: {{oldStatus}} → {{newStatus}} von {{performedByName}}'
      },
      'ticket-priority-changed': {
        title: 'Ticket-Priorität geändert',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" Priorität geändert: {{oldPriority}} → {{newPriority}} von {{performedByName}}'
      },
      'ticket-reassigned': {
        title: 'Ticket neu zugewiesen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" neu zugewiesen: {{oldAssignedTo}} → {{newAssignedTo}} von {{performedByName}}'
      }
    },
    nl: {
      'ticket-assigned': {
        title: 'Ticket toegewezen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) is aan u toegewezen door {{performedByName}}'
      },
      'ticket-created-client': {
        title: 'Uw supportticket is aangemaakt',
        message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is aangemaakt en ons team reageert spoedig'
      },
      'ticket-updated-client': {
        title: 'Uw ticket is bijgewerkt',
        message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is bijgewerkt'
      },
      'ticket-closed-client': {
        title: 'Uw ticket is gesloten',
        message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is gesloten'
      },
      'ticket-comment-added-client': {
        title: 'Nieuwe opmerking bij uw ticket',
        message: '{{authorName}} heeft commentaar gegeven op uw ticket #{{ticketId}}: "{{commentPreview}}"'
      },
      'message-sent': {
        title: 'Nieuw bericht',
        message: '{{senderName}}: {{messagePreview}}'
      },
      'invoice-generated': {
        title: 'Nieuwe factuur gegenereerd',
        message: 'Factuur #{{invoiceNumber}} voor {{clientName}} is gegenereerd'
      },
      'payment-received': {
        title: 'Betaling ontvangen',
        message: 'Betaling van {{amount}} ontvangen voor factuur #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Betaling achterstallig',
        message: 'Factuur #{{invoiceNumber}} is {{daysOverdue}} dagen achterstallig'
      },
      'user-mentioned-in-comment': {
        title: 'U bent genoemd in een opmerking',
        message: '{{commentAuthor}} heeft u genoemd in ticket #{{ticketNumber}}: {{commentPreview}}'
      },
      'user-mentioned-in-document': {
        title: 'Je bent vermeld in een document',
        message: '{{authorName}} heeft je vermeld in document "{{documentName}}"'
      },
      'ticket-status-changed': {
        title: 'Ticket status gewijzigd',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" status gewijzigd: {{oldStatus}} → {{newStatus}} door {{performedByName}}'
      },
      'ticket-priority-changed': {
        title: 'Ticket prioriteit gewijzigd',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" prioriteit gewijzigd: {{oldPriority}} → {{newPriority}} door {{performedByName}}'
      },
      'ticket-reassigned': {
        title: 'Ticket opnieuw toegewezen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" opnieuw toegewezen: {{oldAssignedTo}} → {{newAssignedTo}} door {{performedByName}}'
      }
    },
    it: {
      'ticket-assigned': {
        title: 'Ticket assegnato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) le è stato assegnato da {{performedByName}}'
      },
      'ticket-created-client': {
        title: 'Il suo ticket di supporto è stato creato',
        message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" è stato creato e il nostro team risponderà a breve'
      },
      'ticket-updated-client': {
        title: 'Il suo ticket è stato aggiornato',
        message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" è stato aggiornato'
      },
      'ticket-closed-client': {
        title: 'Il suo ticket è stato chiuso',
        message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" è stato chiuso'
      },
      'ticket-comment-added-client': {
        title: 'Nuovo commento sul suo ticket',
        message: '{{authorName}} ha commentato il suo ticket #{{ticketId}}: "{{commentPreview}}"'
      },
      'message-sent': {
        title: 'Nuovo messaggio',
        message: '{{senderName}}: {{messagePreview}}'
      },
      'invoice-generated': {
        title: 'Nuova fattura generata',
        message: 'La fattura #{{invoiceNumber}} per {{clientName}} è stata generata'
      },
      'payment-received': {
        title: 'Pagamento ricevuto',
        message: 'Pagamento di {{amount}} ricevuto per la fattura #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Pagamento scaduto',
        message: 'La fattura #{{invoiceNumber}} è scaduta da {{daysOverdue}} giorni'
      },
      'user-mentioned-in-comment': {
        title: 'Sei stato menzionato in un commento',
        message: '{{commentAuthor}} ti ha menzionato nel ticket #{{ticketNumber}}: {{commentPreview}}'
      },
      'user-mentioned-in-document': {
        title: 'Sei stato menzionato in un documento',
        message: '{{authorName}} ti ha menzionato nel documento "{{documentName}}"'
      },
      'ticket-status-changed': {
        title: 'Stato del ticket modificato',
        message: 'Stato del ticket #{{ticketId}} "{{ticketTitle}}" modificato: {{oldStatus}} → {{newStatus}} da {{performedByName}}'
      },
      'ticket-priority-changed': {
        title: 'Priorità del ticket modificata',
        message: 'Priorità del ticket #{{ticketId}} "{{ticketTitle}}" modificata: {{oldPriority}} → {{newPriority}} da {{performedByName}}'
      },
      'ticket-reassigned': {
        title: 'Ticket riassegnato',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" riassegnato: {{oldAssignedTo}} → {{newAssignedTo}} da {{performedByName}}'
      }
    }
  };

  const rows = [];
  for (const language of targetLanguages) {
    const languageTemplates = translations[language] || {};
    for (const [name, { title, message }] of Object.entries(languageTemplates)) {
      // Map template name to subtype name (e.g., 'ticket-created-client' -> 'ticket-created')
      const subtypeName = templateToSubtype[name] || name;
      rows.push({
        name,
        language_code: language,
        title,
        message,
        subtype_id: getSubtypeId(subtypeName)
      });
    }
  }

  if (rows.length === 0) {
    console.warn('No translation rows prepared; skipping insert.');
    return;
  }

  await knex('internal_notification_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id')
    });

  console.log('✓ Internal notification template translations seeded');
};

exports.down = async function(knex) {
  const targetLanguages = ['fr', 'es', 'de', 'nl', 'it'];
  await knex('internal_notification_templates')
    .whereIn('language_code', targetLanguages)
    .del();

  console.log('Internal notification template translations removed');
};
