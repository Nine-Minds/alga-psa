/**
 * Source-of-truth: co-managed-routing email template (CM L5, alga-2026-0002879).
 *
 * One generic notification for the three routing moments of a shared ticket (escalation received,
 * escalation returned, assignment). The headline/body arrive as context so the wording lives with the
 * in-app catalog rows in 20261031090100_seed_co_managed_notification_catalog.cjs. English only: other
 * locales fall back to `en` in sendEventEmail.
 */
const TEMPLATE_NAME = 'co-managed-routing';
const SUBTYPE_NAME = 'co-managed-routing';

const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#222;">
  <h2 style="margin:0 0 12px 0;">{{routing.headline}}</h2>
  <p>{{routing.body}}</p>
  <p><a href="{{ticket.url}}">Open ticket #{{ticket.id}}</a></p>
  <p style="color:#666;font-size:12px;">This is an automated message. Please do not reply to this email.</p>
</body></html>`;

const text = `{{routing.headline}}

{{routing.body}}

Open ticket #{{ticket.id}}: {{ticket.url}}

This is an automated message. Please do not reply to this email.`;

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: [{ language: 'en', subject: '{{routing.headline}}', htmlContent: html, textContent: text }],
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
