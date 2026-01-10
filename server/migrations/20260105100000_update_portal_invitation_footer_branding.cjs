/**
 * Update portal-invitation email templates to use Alga PSA branding in footer
 *
 * Changes footer from "© {{currentYear}} {{clientName}}. All rights reserved."
 * to "Powered by Alga PSA" to match ticket notification emails.
 */

exports.up = async function(knex) {
  console.log('Updating portal-invitation template footers to use Alga PSA branding...');

  // Get all portal-invitation templates
  const templates = await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .select('id', 'language_code', 'html_content', 'text_content');

  console.log(`Found ${templates.length} portal-invitation templates to update`);

  for (const template of templates) {
    let { html_content, text_content } = template;

    // Update HTML content - replace the copyright line in the footer
    // The footer has 3 <p> tags, we need to replace the last one
    // Match patterns like: <p>© {{currentYear}} {{clientName}}. [All rights reserved in any language]</p>
    html_content = html_content.replace(
      /<p>©\s*\{\{currentYear\}\}\s*\{\{clientName\}\}[^<]*<\/p>/g,
      '<p>Powered by Alga PSA</p>'
    );

    // Update text content - replace the copyright line
    // Match patterns like: © {{currentYear}} {{clientName}}. All rights reserved.
    // The copyright lines in text are typically at the end
    text_content = text_content.replace(
      /©\s*\{\{currentYear\}\}\s*\{\{clientName\}\}[^\n]*/g,
      'Powered by Alga PSA'
    );

    await knex('system_email_templates')
      .where({ id: template.id })
      .update({
        html_content,
        text_content
      });

    console.log(`  ✓ Updated ${template.language_code} portal-invitation template`);
  }

  console.log('✓ All portal-invitation templates updated with Alga PSA branding');
};

exports.down = async function(knex) {
  console.log('Reverting portal-invitation template footers to client name...');

  // Language-specific copyright phrases
  const copyrightPhrases = {
    en: '© {{currentYear}} {{clientName}}. All rights reserved.',
    fr: '© {{currentYear}} {{clientName}}. Tous droits réservés.',
    es: '© {{currentYear}} {{clientName}}. Todos los derechos reservados.',
    de: '© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.',
    nl: '© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.',
    it: '© {{currentYear}} {{clientName}}. Tutti i diritti riservati.',
    pl: '© {{currentYear}} {{clientName}}. Wszelkie prawa zastrzeżone.'
  };

  const templates = await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .select('id', 'language_code', 'html_content', 'text_content');

  for (const template of templates) {
    let { html_content, text_content } = template;
    const langCode = template.language_code;
    const copyrightPhrase = copyrightPhrases[langCode] || copyrightPhrases.en;

    // Revert HTML content
    html_content = html_content.replace(
      /<p>Powered by Alga PSA<\/p>/g,
      `<p>${copyrightPhrase}</p>`
    );

    // Revert text content
    text_content = text_content.replace(
      /Powered by Alga PSA/g,
      copyrightPhrase
    );

    await knex('system_email_templates')
      .where({ id: template.id })
      .update({
        html_content,
        text_content
      });

    console.log(`  ✓ Reverted ${template.language_code} portal-invitation template`);
  }

  console.log('✓ All portal-invitation templates reverted to client name branding');
};
