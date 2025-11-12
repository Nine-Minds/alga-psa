/**
 * Add notification subtypes and templates for additional agent assignments
 */

exports.up = async function(knex) {
  console.log('Adding additional agent notification subtypes and templates...');

  // 1. Get category IDs
  const ticketsCat = await knex('internal_notification_categories')
    .select('internal_notification_category_id')
    .where('name', 'tickets')
    .first();

  const projectsCat = await knex('internal_notification_categories')
    .select('internal_notification_category_id')
    .where('name', 'projects')
    .first();

  if (!ticketsCat || !projectsCat) {
    throw new Error('Required notification categories not found');
  }

  // 2. Insert new subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      // Ticket subtypes
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-additional-agent-assigned',
        description: 'User assigned as additional agent on ticket',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-additional-agent-added',
        description: 'Additional agent added to ticket (for primary assignee)',
        is_enabled: true,
        is_default_enabled: true
      },
      // Project task subtypes
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'task-additional-agent-assigned',
        description: 'User assigned as additional agent on task',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'task-additional-agent-added',
        description: 'Additional agent added to task (for primary assignee)',
        is_enabled: true,
        is_default_enabled: true
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description')
    })
    .returning('*');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.internal_notification_subtype_id;
  };

  // 3. Define translations for all supported languages
  const translations = {
    en: {
      'ticket-additional-agent-assigned': {
        title: 'Added as Additional Agent',
        message: 'You have been added as an additional agent on ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
      },
      'ticket-additional-agent-added': {
        title: 'Additional Agent Added',
        message: '{{additionalAgentName}} has been added as an additional agent on your ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'ticket-additional-agent-added-client': {
        title: 'Additional Support Agent Assigned',
        message: '{{additionalAgentName}} has been added to help with your ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'task-additional-agent-assigned': {
        title: 'Added as Additional Agent',
        message: 'You have been added as an additional agent on task "{{taskName}}" in project "{{projectName}}"'
      },
      'task-additional-agent-added': {
        title: 'Additional Agent Added',
        message: '{{additionalAgentName}} has been added as an additional agent on your task "{{taskName}}" in project "{{projectName}}"'
      }
    },
    fr: {
      'ticket-additional-agent-assigned': {
        title: 'Ajouté comme agent supplémentaire',
        message: 'Vous avez été ajouté comme agent supplémentaire sur le ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
      },
      'ticket-additional-agent-added': {
        title: 'Agent supplémentaire ajouté',
        message: '{{additionalAgentName}} a été ajouté comme agent supplémentaire sur votre ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'ticket-additional-agent-added-client': {
        title: 'Agent de support supplémentaire assigné',
        message: '{{additionalAgentName}} a été ajouté pour vous aider avec votre ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'task-additional-agent-assigned': {
        title: 'Ajouté comme agent supplémentaire',
        message: 'Vous avez été ajouté comme agent supplémentaire sur la tâche "{{taskName}}" dans le projet "{{projectName}}"'
      },
      'task-additional-agent-added': {
        title: 'Agent supplémentaire ajouté',
        message: '{{additionalAgentName}} a été ajouté comme agent supplémentaire sur votre tâche "{{taskName}}" dans le projet "{{projectName}}"'
      }
    },
    es: {
      'ticket-additional-agent-assigned': {
        title: 'Agregado como agente adicional',
        message: 'Ha sido agregado como agente adicional en el ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
      },
      'ticket-additional-agent-added': {
        title: 'Agente adicional agregado',
        message: '{{additionalAgentName}} ha sido agregado como agente adicional en su ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'ticket-additional-agent-added-client': {
        title: 'Agente de soporte adicional asignado',
        message: '{{additionalAgentName}} ha sido agregado para ayudar con su ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'task-additional-agent-assigned': {
        title: 'Agregado como agente adicional',
        message: 'Ha sido agregado como agente adicional en la tarea "{{taskName}}" del proyecto "{{projectName}}"'
      },
      'task-additional-agent-added': {
        title: 'Agente adicional agregado',
        message: '{{additionalAgentName}} ha sido agregado como agente adicional en su tarea "{{taskName}}" del proyecto "{{projectName}}"'
      }
    },
    de: {
      'ticket-additional-agent-assigned': {
        title: 'Als zusätzlicher Agent hinzugefügt',
        message: 'Sie wurden als zusätzlicher Agent zum Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) hinzugefügt'
      },
      'ticket-additional-agent-added': {
        title: 'Zusätzlicher Agent hinzugefügt',
        message: '{{additionalAgentName}} wurde als zusätzlicher Agent zu Ihrem Ticket #{{ticketId}} "{{ticketTitle}}" hinzugefügt'
      },
      'ticket-additional-agent-added-client': {
        title: 'Zusätzlicher Support-Mitarbeiter zugewiesen',
        message: '{{additionalAgentName}} wurde hinzugefügt, um bei Ihrem Ticket #{{ticketId}} "{{ticketTitle}}" zu helfen'
      },
      'task-additional-agent-assigned': {
        title: 'Als zusätzlicher Agent hinzugefügt',
        message: 'Sie wurden als zusätzlicher Agent zur Aufgabe "{{taskName}}" im Projekt "{{projectName}}" hinzugefügt'
      },
      'task-additional-agent-added': {
        title: 'Zusätzlicher Agent hinzugefügt',
        message: '{{additionalAgentName}} wurde als zusätzlicher Agent zu Ihrer Aufgabe "{{taskName}}" im Projekt "{{projectName}}" hinzugefügt'
      }
    },
    nl: {
      'ticket-additional-agent-assigned': {
        title: 'Toegevoegd als extra agent',
        message: 'U bent toegevoegd als extra agent aan ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
      },
      'ticket-additional-agent-added': {
        title: 'Extra agent toegevoegd',
        message: '{{additionalAgentName}} is toegevoegd als extra agent aan uw ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'ticket-additional-agent-added-client': {
        title: 'Extra ondersteuningsagent toegewezen',
        message: '{{additionalAgentName}} is toegevoegd om te helpen met uw ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'task-additional-agent-assigned': {
        title: 'Toegevoegd als extra agent',
        message: 'U bent toegevoegd als extra agent aan taak "{{taskName}}" in project "{{projectName}}"'
      },
      'task-additional-agent-added': {
        title: 'Extra agent toegevoegd',
        message: '{{additionalAgentName}} is toegevoegd als extra agent aan uw taak "{{taskName}}" in project "{{projectName}}"'
      }
    },
    it: {
      'ticket-additional-agent-assigned': {
        title: 'Aggiunto come agente aggiuntivo',
        message: 'Sei stato aggiunto come agente aggiuntivo al ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
      },
      'ticket-additional-agent-added': {
        title: 'Agente aggiuntivo aggiunto',
        message: '{{additionalAgentName}} è stato aggiunto come agente aggiuntivo al suo ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'ticket-additional-agent-added-client': {
        title: 'Agente di supporto aggiuntivo assegnato',
        message: '{{additionalAgentName}} è stato aggiunto per aiutare con il suo ticket #{{ticketId}} "{{ticketTitle}}"'
      },
      'task-additional-agent-assigned': {
        title: 'Aggiunto come agente aggiuntivo',
        message: 'Sei stato aggiunto come agente aggiuntivo al task "{{taskName}}" nel progetto "{{projectName}}"'
      },
      'task-additional-agent-added': {
        title: 'Agente aggiuntivo aggiunto',
        message: '{{additionalAgentName}} è stato aggiunto come agente aggiuntivo al suo task "{{taskName}}" nel progetto "{{projectName}}"'
      }
    }
  };

  // Map template names to their corresponding subtype names
  const templateToSubtype = {
    'ticket-additional-agent-assigned': 'ticket-additional-agent-assigned',
    'ticket-additional-agent-added': 'ticket-additional-agent-added',
    'ticket-additional-agent-added-client': 'ticket-additional-agent-added',
    'task-additional-agent-assigned': 'task-additional-agent-assigned',
    'task-additional-agent-added': 'task-additional-agent-added'
  };

  // 4. Insert templates for all languages
  const rows = [];
  const languages = ['en', 'fr', 'es', 'de', 'nl', 'it'];

  for (const language of languages) {
    const languageTemplates = translations[language] || {};
    for (const [name, { title, message }] of Object.entries(languageTemplates)) {
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

  if (rows.length > 0) {
    await knex('internal_notification_templates')
      .insert(rows)
      .onConflict(['name', 'language_code'])
      .merge({
        title: knex.raw('excluded.title'),
        message: knex.raw('excluded.message')
      });
  }

  console.log(`Successfully added additional agent notification templates for ${languages.length} languages`);
};

exports.down = async function(knex) {
  console.log('Removing additional agent notification templates...');

  // Delete templates
  await knex('internal_notification_templates')
    .whereIn('name', [
      'ticket-additional-agent-assigned',
      'ticket-additional-agent-added',
      'ticket-additional-agent-added-client',
      'task-additional-agent-assigned',
      'task-additional-agent-added'
    ])
    .delete();

  // Delete subtypes
  await knex('internal_notification_subtypes')
    .whereIn('name', [
      'ticket-additional-agent-assigned',
      'ticket-additional-agent-added',
      'task-additional-agent-assigned',
      'task-additional-agent-added'
    ])
    .delete();

  console.log('Successfully removed additional agent notification templates');
};
