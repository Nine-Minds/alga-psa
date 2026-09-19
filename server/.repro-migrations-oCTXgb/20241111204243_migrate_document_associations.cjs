exports.up = async function(knex) {
  // Get all documents with existing associations
  const documents = await knex('documents')
    .select('document_id', 'tenant', 'ticket_id', 'company_id', 'contact_name_id', 'schedule_id')
    .whereNotNull('ticket_id')
    .orWhereNotNull('company_id')
    .orWhereNotNull('contact_name_id')
    .orWhereNotNull('schedule_id');

  // Create associations for each document
  const associations = [];
  for (const doc of documents) {
    if (doc.ticket_id) {
      associations.push({
        document_id: doc.document_id,
        tenant: doc.tenant,
        entity_id: doc.ticket_id,
        entity_type: 'ticket'
      });
    }
    if (doc.company_id) {
      associations.push({
        document_id: doc.document_id,
        tenant: doc.tenant,
        entity_id: doc.company_id,
        entity_type: 'company'
      });
    }
    if (doc.contact_name_id) {
      associations.push({
        document_id: doc.document_id,
        tenant: doc.tenant,
        entity_id: doc.contact_name_id,
        entity_type: 'contact'
      });
    }
    if (doc.schedule_id) {
      associations.push({
        document_id: doc.document_id,
        tenant: doc.tenant,
        entity_id: doc.schedule_id,
        entity_type: 'schedule'
      });
    }
  }

  // Insert all associations
  if (associations.length > 0) {
    await knex('document_associations').insert(associations);
  }

  // Remove the old association columns from documents table
  return knex.schema.alterTable('documents', function(table) {
    table.dropColumn('ticket_id');
    table.dropColumn('company_id');
    table.dropColumn('contact_name_id');
    table.dropColumn('schedule_id');
  });
};

exports.down = async function(knex) {
  // Add back the association columns
  await knex.schema.alterTable('documents', function(table) {
    table.uuid('ticket_id').references('ticket_id').inTable('tickets').onDelete('CASCADE');
    table.uuid('company_id').references('company_id').inTable('companies').onDelete('CASCADE');
    table.uuid('contact_name_id').references('contact_name_id').inTable('contact_names').onDelete('CASCADE');
    table.uuid('schedule_id').references('schedule_id').inTable('schedules').onDelete('CASCADE');
  });

  // Get all associations
  const associations = await knex('document_associations')
    .select('document_id', 'tenant', 'entity_id', 'entity_type');

  // Update documents with their associations
  for (const assoc of associations) {
    const update = {};
    switch (assoc.entity_type) {
      case 'ticket':
        update.ticket_id = assoc.entity_id;
        break;
      case 'company':
        update.company_id = assoc.entity_id;
        break;
      case 'contact':
        update.contact_name_id = assoc.entity_id;
        break;
      case 'schedule':
        update.schedule_id = assoc.entity_id;
        break;
    }
    await knex('documents')
      .where({ 
        document_id: assoc.document_id,
        tenant: assoc.tenant
      })
      .update(update);
  }

  // Drop the associations table
  return knex.schema.dropTable('document_associations');
};
