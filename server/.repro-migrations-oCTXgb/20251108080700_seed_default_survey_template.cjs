const DEFAULT_TEMPLATE_NAME = 'Default CSAT Survey';
const DEFAULT_PROMPT = 'How would you rate your support experience?';
const DEFAULT_COMMENT_PROMPT = 'Additional comments (optional)';
const DEFAULT_THANK_YOU = 'Thank you for your feedback!';

function buildRatingLabels() {
  return {
    1: 'Very Poor',
    2: 'Poor',
    3: 'Average',
    4: 'Good',
    5: 'Excellent',
  };
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    // Skip if a default template already exists for the tenant
    const existing = await knex('survey_templates')
      .where({ tenant, is_default: true })
      .first();

    if (existing) {
      continue;
    }

    await knex('survey_templates').insert({
      tenant,
      template_name: DEFAULT_TEMPLATE_NAME,
      is_default: true,
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: buildRatingLabels(),
      prompt_text: DEFAULT_PROMPT,
      comment_prompt: DEFAULT_COMMENT_PROMPT,
      thank_you_text: DEFAULT_THANK_YOU,
      enabled: true,
    });
  }
};

exports.down = async function down(knex) {
  await knex('survey_templates')
    .where({ is_default: true, template_name: DEFAULT_TEMPLATE_NAME })
    .del();
};
