const {
  SURVEY_TEMPLATE_NAME: TEMPLATE_NAME,
  SURVEY_SUBTYPE_NAME: SUBTYPE_NAME,
  SURVEY_CATEGORY_NAME: CATEGORY_NAME,
  SURVEY_TEMPLATE_TRANSLATIONS: TRANSLATIONS,
  buildSurveyHtmlTemplate,
  buildSurveyTextTemplate,
} = require('./utils/surveyEmailTemplates.cjs');

exports.up = async function up(knex) {
  const now = new Date();

  let surveysCategory = await knex('notification_categories').where({ name: CATEGORY_NAME }).first();
  if (!surveysCategory) {
    [surveysCategory] = await knex('notification_categories')
      .insert({
        name: CATEGORY_NAME,
        description: 'Customer satisfaction surveys and feedback loops',
        is_enabled: true,
        is_default_enabled: true,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
  } else {
    [surveysCategory] = await knex('notification_categories')
      .where({ id: surveysCategory.id })
      .update({
        description: 'Customer satisfaction surveys and feedback loops',
        updated_at: now,
      })
      .returning('*');
  }

  let surveySubtype = await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).first();
  if (!surveySubtype) {
    [surveySubtype] = await knex('notification_subtypes')
      .insert({
        category_id: surveysCategory.id,
        name: SUBTYPE_NAME,
        description: 'Customer satisfaction survey invitation when a ticket is closed',
        is_enabled: true,
        is_default_enabled: true,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
  } else {
    [surveySubtype] = await knex('notification_subtypes')
      .where({ id: surveySubtype.id })
      .update({
        category_id: surveysCategory.id,
        description: 'Customer satisfaction survey invitation when a ticket is closed',
        updated_at: now,
      })
      .returning('*');
  }

  for (const translation of TRANSLATIONS) {
    const payload = {
      name: TEMPLATE_NAME,
      language_code: translation.language,
      subject: translation.subject,
      html_content: buildSurveyHtmlTemplate(translation),
      text_content: buildSurveyTextTemplate(translation),
      notification_subtype_id: surveySubtype.id,
      updated_at: now,
      created_at: now,
    };

    const existingTemplate = await knex('system_email_templates')
      .where({ name: TEMPLATE_NAME, language_code: translation.language })
      .first();

    if (existingTemplate) {
      await knex('system_email_templates')
        .where({ id: existingTemplate.id })
        .update({ ...payload, created_at: existingTemplate.created_at });
    } else {
      await knex('system_email_templates').insert(payload);
    }
  }
};

exports.down = async function down(knex) {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();

  const surveySubtype = await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).first();
  if (surveySubtype) {
    await knex('notification_subtypes').where({ id: surveySubtype.id }).del();
  }

  const surveysCategory = await knex('notification_categories').where({ name: CATEGORY_NAME }).first();
  if (surveysCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: surveysCategory.id })
      .count('id as count')
      .first();

    if (!remainingSubtypes || Number(remainingSubtypes.count) === 0) {
      await knex('notification_categories').where({ id: surveysCategory.id }).del();
    }
  }
};
