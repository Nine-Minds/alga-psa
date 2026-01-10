/**
 * Fix HTML content escaping in email templates
 *
 * The email templates use Handlebars which escapes HTML by default with double braces {{...}}.
 * Fields that contain HTML content (like comment.content, ticket.description, etc.) need to
 * use triple braces {{{...}}} to render the HTML properly instead of showing raw HTML tags.
 *
 * This affects ticket notification emails where:
 * - comment.content contains HTML from BlockNote editor
 * - ticket.description may contain HTML
 * - ticket.changes may contain HTML
 * - ticket.resolution may contain HTML
 */

exports.up = async function(knex) {
  console.log('Fixing HTML content escaping in email templates...');

  // List of HTML content fields that need triple braces
  // We only update html_content column since text is derived from rendered HTML
  const htmlFields = [
    { double: '{{comment.content}}', triple: '{{{comment.content}}}' },
    { double: '{{ticket.description}}', triple: '{{{ticket.description}}}' },
    { double: '{{ticket.changes}}', triple: '{{{ticket.changes}}}' },
    { double: '{{ticket.resolution}}', triple: '{{{ticket.resolution}}}' },
  ];

  // Update system_email_templates
  for (const field of htmlFields) {
    // Only update html_content where double braces exist (case-sensitive match)
    await knex.raw(`
      UPDATE system_email_templates
      SET html_content = REPLACE(html_content, ?, ?)
      WHERE html_content LIKE ?
    `, [field.double, field.triple, `%${field.double}%`]);
  }

  // Also update tenant_email_templates if any exist
  for (const field of htmlFields) {
    await knex.raw(`
      UPDATE tenant_email_templates
      SET html_content = REPLACE(html_content, ?, ?)
      WHERE html_content LIKE ?
    `, [field.double, field.triple, `%${field.double}%`]);
  }

  console.log('✓ Email templates updated to properly render HTML content');
};

exports.down = async function(knex) {
  console.log('Reverting HTML content escaping fix in email templates...');

  // Revert back to double braces
  const htmlFields = [
    { double: '{{comment.content}}', triple: '{{{comment.content}}}' },
    { double: '{{ticket.description}}', triple: '{{{ticket.description}}}' },
    { double: '{{ticket.changes}}', triple: '{{{ticket.changes}}}' },
    { double: '{{ticket.resolution}}', triple: '{{{ticket.resolution}}}' },
  ];

  // Revert system_email_templates
  for (const field of htmlFields) {
    await knex.raw(`
      UPDATE system_email_templates
      SET html_content = REPLACE(html_content, ?, ?)
      WHERE html_content LIKE ?
    `, [field.triple, field.double, `%${field.triple}%`]);
  }

  // Also revert tenant_email_templates
  for (const field of htmlFields) {
    await knex.raw(`
      UPDATE tenant_email_templates
      SET html_content = REPLACE(html_content, ?, ?)
      WHERE html_content LIKE ?
    `, [field.triple, field.double, `%${field.triple}%`]);
  }

  console.log('Email templates reverted to escape HTML content');
};
