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
    'message-sent': 'message-sent'
  };

  const translations = {
    fr: {
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
        message: '{{authorName}} a ajouté un commentaire à votre ticket #{{ticketId}}'
      },
      'message-sent': {
        title: 'Nouveau message',
        message: '{{senderName}}: {{messagePreview}}'
      }
    },
    es: {
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
        message: '{{authorName}} agregó un comentario a su ticket #{{ticketId}}'
      },
      'message-sent': {
        title: 'Nuevo mensaje',
        message: '{{senderName}}: {{messagePreview}}'
      }
    },
    de: {
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
        message: '{{authorName}} hat einen Kommentar zu Ihrem Ticket #{{ticketId}} hinzugefügt'
      },
      'message-sent': {
        title: 'Neue Nachricht',
        message: '{{senderName}}: {{messagePreview}}'
      }
    },
    nl: {
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
        message: '{{authorName}} heeft een opmerking toegevoegd aan uw ticket #{{ticketId}}'
      },
      'message-sent': {
        title: 'Nieuw bericht',
        message: '{{senderName}}: {{messagePreview}}'
      }
    },
    it: {
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
        message: '{{authorName}} ha aggiunto un commento al suo ticket #{{ticketId}}'
      },
      'message-sent': {
        title: 'Nuovo messaggio',
        message: '{{senderName}}: {{messagePreview}}'
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
