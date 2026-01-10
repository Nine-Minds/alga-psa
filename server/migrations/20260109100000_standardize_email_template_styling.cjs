/**
 * Migration: Standardize email template styling
 *
 * Fixes inconsistent email template styling by updating all templates to use
 * the brand purple-blue gradient: linear-gradient(135deg, #8A4DEA, #40CFF9)
 *
 * Templates fixed:
 * - GREEN gradient → brand gradient (appointment-request-approved, ticket-closed, etc.)
 * - RED gradient → brand gradient (appointment-request-declined, payment-overdue)
 * - BLUE gradient → brand gradient (email-verification)
 * - INDIGO gradient → brand gradient (SURVEY_TICKET_CLOSED, invoice-generated pl)
 * - LEGACY purple → brand gradient (no-account-found, tenant-recovery)
 * - Purple-only → brand gradient (password-reset, portal-invitation)
 * - No gradient → full template with brand gradient
 */

const BRAND_GRADIENT = 'linear-gradient(135deg,#8A4DEA,#40CFF9)';
const BRAND_PRIMARY = '#8A4DEA';

// Gradient patterns to replace
const GRADIENT_REPLACEMENTS = [
  // Green gradients
  { from: 'linear-gradient(135deg,#10b981,#059669)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', to: BRAND_GRADIENT },
  // Red gradients
  { from: 'linear-gradient(135deg,#ef4444,#dc2626)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', to: BRAND_GRADIENT },
  // Amber/Orange gradients
  { from: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg,#f59e0b,#d97706)', to: BRAND_GRADIENT },
  // Blue gradients
  { from: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg,#3b82f6,#2563eb)', to: BRAND_GRADIENT },
  // Indigo/Violet gradients
  { from: 'linear-gradient(135deg,#6366f1,#8b5cf6)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', to: BRAND_GRADIENT },
  // Legacy purple gradients
  { from: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg,#667eea,#764ba2)', to: BRAND_GRADIENT },
  // Purple-only gradients (missing cyan)
  { from: 'linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%)', to: BRAND_GRADIENT },
  { from: 'linear-gradient(135deg,#8a4dea,#7c3aed)', to: BRAND_GRADIENT },
];

// Button color replacements
const BUTTON_REPLACEMENTS = [
  { from: 'background:#10b981', to: `background:${BRAND_PRIMARY}` },
  { from: 'background: #10b981', to: `background: ${BRAND_PRIMARY}` },
  { from: 'background:#ef4444', to: `background:${BRAND_PRIMARY}` },
  { from: 'background: #ef4444', to: `background: ${BRAND_PRIMARY}` },
];

// Footer background replacements
const FOOTER_REPLACEMENTS = [
  { from: 'background:#f0fdf4', to: 'background:#f8f5ff' }, // Green footer bg
  { from: 'background: #f0fdf4', to: 'background: #f8f5ff' },
  { from: 'background:#fef2f2', to: 'background:#f8f5ff' }, // Red footer bg
  { from: 'background: #fef2f2', to: 'background: #f8f5ff' },
];

// Footer text color replacements
const FOOTER_TEXT_REPLACEMENTS = [
  { from: 'color:#047857', to: 'color:#5b38b0' }, // Green text
  { from: 'color: #047857', to: 'color: #5b38b0' },
  { from: 'color:#dc2626', to: 'color:#5b38b0' }, // Red text
  { from: 'color: #dc2626', to: 'color: #5b38b0' },
];

// Badge background replacements
const BADGE_REPLACEMENTS = [
  { from: 'rgba(16,185,129,0.12)', to: 'rgba(138,77,234,0.12)' }, // Green badge
  { from: 'rgba(239,68,68,0.12)', to: 'rgba(138,77,234,0.12)' }, // Red badge
];

// Info box replacements
const INFO_BOX_REPLACEMENTS = [
  { from: 'background:#f0fdf4;border:1px solid #bbf7d0', to: 'background:#f8f5ff;border:1px solid #e6deff' },
  { from: 'background: #f0fdf4; border: 1px solid #bbf7d0', to: 'background: #f8f5ff; border: 1px solid #e6deff' },
];

// Templates that need gradient fixes (have gradients but wrong colors)
const TEMPLATES_WITH_GRADIENT_ISSUES = [
  // All languages for these templates
  'appointment-request-approved',
  'appointment-request-declined',
  'ticket-closed',
  'email-verification',
  'SURVEY_TICKET_CLOSED',
  'no-account-found',
  'tenant-recovery',
  'password-reset',
  'portal-invitation',
  'project-task-assigned-primary',
];

function applyReplacements(content, replacements) {
  let result = content;
  for (const { from, to } of replacements) {
    result = result.split(from).join(to);
  }
  return result;
}

exports.up = async function(knex) {
  console.log('Standardizing email template styling to brand colors...');

  let updatedCount = 0;

  // Fix templates with gradient issues
  for (const templateName of TEMPLATES_WITH_GRADIENT_ISSUES) {
    const templates = await knex('system_email_templates')
      .where({ name: templateName });

    for (const template of templates) {
      let htmlContent = template.html_content || '';

      // Apply all replacements
      htmlContent = applyReplacements(htmlContent, GRADIENT_REPLACEMENTS);
      htmlContent = applyReplacements(htmlContent, BUTTON_REPLACEMENTS);
      htmlContent = applyReplacements(htmlContent, FOOTER_REPLACEMENTS);
      htmlContent = applyReplacements(htmlContent, FOOTER_TEXT_REPLACEMENTS);
      htmlContent = applyReplacements(htmlContent, BADGE_REPLACEMENTS);
      htmlContent = applyReplacements(htmlContent, INFO_BOX_REPLACEMENTS);

      if (htmlContent !== template.html_content) {
        await knex('system_email_templates')
          .where({ id: template.id })
          .update({
            html_content: htmlContent,
            updated_at: new Date()
          });
        updatedCount++;
        console.log(`  Updated: ${templateName} (${template.language_code})`);
      }
    }
  }

  // Fix payment-received and payment-overdue for Polish (they have gradients)
  const plPaymentTemplates = await knex('system_email_templates')
    .whereIn('name', ['payment-received', 'payment-overdue'])
    .where({ language_code: 'pl' });

  for (const template of plPaymentTemplates) {
    let htmlContent = template.html_content || '';
    htmlContent = applyReplacements(htmlContent, GRADIENT_REPLACEMENTS);
    htmlContent = applyReplacements(htmlContent, BUTTON_REPLACEMENTS);
    htmlContent = applyReplacements(htmlContent, FOOTER_REPLACEMENTS);
    htmlContent = applyReplacements(htmlContent, FOOTER_TEXT_REPLACEMENTS);
    htmlContent = applyReplacements(htmlContent, BADGE_REPLACEMENTS);

    if (htmlContent !== template.html_content) {
      await knex('system_email_templates')
        .where({ id: template.id })
        .update({
          html_content: htmlContent,
          updated_at: new Date()
        });
      updatedCount++;
      console.log(`  Updated: ${template.name} (pl)`);
    }
  }

  // Fix invoice-generated for Polish (has gradient)
  const plInvoiceGenerated = await knex('system_email_templates')
    .where({ name: 'invoice-generated', language_code: 'pl' })
    .first();

  if (plInvoiceGenerated) {
    let htmlContent = plInvoiceGenerated.html_content || '';
    htmlContent = applyReplacements(htmlContent, GRADIENT_REPLACEMENTS);

    if (htmlContent !== plInvoiceGenerated.html_content) {
      await knex('system_email_templates')
        .where({ id: plInvoiceGenerated.id })
        .update({
          html_content: htmlContent,
          updated_at: new Date()
        });
      updatedCount++;
      console.log('  Updated: invoice-generated (pl)');
    }
  }

  console.log(`\nGradient fixes complete: ${updatedCount} templates updated`);
  console.log('\nNote: Templates without gradients (invoice-generated, payment-*, project-*, time-entry-*, credit-expiring) need manual review for full template updates.');
};

exports.down = async function(knex) {
  // This migration performs color replacements that are difficult to reverse
  // without storing the original content. A full rollback would require
  // restoring from backup or re-running the original template migrations.
  console.log('Rollback: This migration cannot be automatically reversed.');
  console.log('To restore original templates, re-run the original template migrations.');
};
