exports.up = async function(knex) {
  // First, drop the existing constraint
  await knex.raw(`
    ALTER TABLE public.document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
  `);

  // Add the new constraint that includes 'tenant' as a valid entity type
  await knex.raw(`
    ALTER TABLE public.document_associations
    ADD CONSTRAINT document_associations_entity_type_check
    CHECK ((entity_type)::text = ANY ((ARRAY[
      'user'::character varying,
      'ticket'::character varying,
      'company'::character varying,
      'contact'::character varying,
      'asset'::character varying,
      'project_task'::character varying,
      'tenant'::character varying
    ])::text[]))
  `);
};

exports.down = async function(knex) {
  // Revert: drop the constraint with 'tenant'
  await knex.raw(`
    ALTER TABLE public.document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
  `);

  // Re-add the original constraint without 'tenant'
  await knex.raw(`
    ALTER TABLE public.document_associations
    ADD CONSTRAINT document_associations_entity_type_check
    CHECK ((entity_type)::text = ANY ((ARRAY[
      'user'::character varying,
      'ticket'::character varying,
      'company'::character varying,
      'contact'::character varying,
      'asset'::character varying,
      'project_task'::character varying
    ])::text[]))
  `);
};