/**
 * Source-of-truth: SLA warning email template.
 *
 * Sent when a ticket is approaching its SLA deadline (threshold-based).
 * English-only — SLA notifications are internal-only.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, BADGE_BG, BRAND_DARK } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'sla-warning';
const SUBTYPE_NAME = 'SLA Warning';

function buildBodyHtml() {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Hi {{recipientName}},</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A ticket you are responsible for is approaching its SLA deadline.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Ticket</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">#{{ticketNumber}}</span>
                  {{ticketTitle}}
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">SLA Type</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{slaType}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Time Remaining</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="font-size:16px;font-weight:700;color:#d97706;">{{timeRemaining}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Priority</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">Client</td>
                <td style="padding:12px 0;">{{clientName}}</td>
              </tr>
            </table>
            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Please take action to avoid an SLA breach.</p>
            {{#if ticketUrl}}
            <div style="text-align:center;margin:24px 0;">
              <a href="{{ticketUrl}}" style="display:inline-block;padding:14px 32px;border-radius:8px;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Ticket</a>
            </div>
            {{/if}}`;
}

function buildText() {
  return `SLA WARNING: {{thresholdPercent}}% Time Elapsed

Hi {{recipientName}},

A ticket you are responsible for is approaching its SLA deadline.

Ticket Details:
- Ticket: #{{ticketNumber}} - {{ticketTitle}}
- SLA Type: {{slaType}}
- Time Remaining: {{timeRemaining}}
- Priority: {{priority}}
- Client: {{clientName}}

Please take action to avoid an SLA breach.

{{#if ticketUrl}}
View Ticket: {{ticketUrl}}
{{/if}}

---
Powered by Alga PSA`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: [
      {
        language: 'en',
        subject: 'SLA Warning: Ticket #{{ticketNumber}} at {{thresholdPercent}}%',
        htmlContent: wrapEmailLayout({
          language: 'en',
          headerLabel: 'SLA Warning',
          headerTitle: '{{thresholdPercent}}% Time Elapsed',
          headerMeta: 'Ticket #{{ticketNumber}}',
          bodyHtml: buildBodyHtml(),
        }),
        textContent: buildText(),
      },
    ],
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
