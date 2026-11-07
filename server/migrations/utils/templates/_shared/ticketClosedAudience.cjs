const path = require('node:path');
const { wrapEmailLayout } = require('./emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
  SUPPORTED_LANGUAGES,
} = require('./constants.cjs');

const localeRoot = path.resolve(__dirname, '../../../../public/locales');
const requiredKeys = Object.keys(require(path.join(localeRoot, 'en', 'email.json')).ticketClosed);

function copyFor(language) {
  const copy = require(path.join(localeRoot, language, 'email.json')).ticketClosed;
  for (const key of requiredKeys) {
    if (typeof copy?.[key] !== 'string' || !copy[key].trim()) {
      throw new Error(`Missing email.ticketClosed.${key} translation for ${language}`);
    }
  }
  return copy;
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${label}</td>
    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${value}</td>
  </tr>`;
}

function optionalRow(path, label) {
  return `{{#if ${path}}}${detailRow(label, `{{${path}}}`)}{{/if}}`;
}

function devicesHtml(copy) {
  const header = (text) => `<th scope="col" style="text-align:left;padding:6px 10px;border-bottom:2px solid rgba(146,64,14,0.25);font-weight:600;color:#1f2933;">${text}</th>`;
  const cell = (value) => `<td style="padding:6px 10px;border-bottom:1px solid rgba(146,64,14,0.15);color:#1f2933;word-break:break-word;">${value}</td>`;
  return `{{#if ticket.assets}}
  <div style="margin:24px 0 0 0;">
    <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.devices}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0;font-size:13px;">
      <thead><tr>${header(copy.deviceName)}${header(copy.deviceType)}${header(copy.manufacturerModel)}${header(copy.serialNumber)}</tr></thead>
      <tbody>{{#each ticket.assets}}<tr>${cell('{{name}}')}${cell('{{assetType}}')}${cell('{{manufacturer}} {{model}}')}${cell('{{serialNumber}}')}</tr>{{/each}}</tbody>
    </table>
  </div>
  {{/if}}`;
}

function buildHtml(copy, internal) {
  const internalDetails = internal ? `
  {{#if ticket.timeHtml}}
  <div style="margin:24px 0 0 0;"><div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.timeEntries}</div>{{{ticket.timeHtml}}}</div>
  {{/if}}
  {{#if ticket.materialsHtml}}
  <div style="margin:24px 0 0 0;"><div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.materials}</div>{{{ticket.materialsHtml}}}</div>
  {{/if}}
  {{#if ticket.materialsTotal}}<p><strong>${copy.materialsTotal}:</strong> {{ticket.materialsTotal}}</p>{{/if}}` : '';

  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${copy.intro}</p>
  <div style="margin-bottom:24px;"><div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;">${copy.ticketNumber}{{ticket.id}}</div></div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
    ${detailRow(copy.status, `<span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${BRAND_PRIMARY};color:#ffffff;font-weight:600;">${copy.closed}</span>`)}
    ${detailRow(copy.closedBy, '{{ticket.closedBy}}')}
    ${detailRow(copy.assignedTo, '<div style="font-weight:600;">{{ticket.assignedToName}}</div><div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>')}
    ${detailRow(copy.requester, '<div style="font-weight:600;">{{ticket.requesterName}}</div><div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>')}
    ${detailRow(copy.category, '{{ticket.categoryPath}}')}
    ${detailRow(copy.location, '{{ticket.locationSummary}}')}
    ${optionalRow('ticket.totalTimeWorked', copy.totalTimeWorked)}
    ${optionalRow('ticket.totalTimeBillable', copy.totalBillableTime)}
    ${optionalRow('ticket.remainingBlockHours', copy.remainingHours)}
  </table>
  ${devicesHtml(copy)}
  ${internalDetails}
  <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
    <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${copy.resolution}</div>
    <div style="color:#475467;line-height:1.5;">{{{ticket.resolution}}}</div>
  </div>`;
}

function buildText(copy, internal) {
  return `${copy.title}

${copy.ticketNumber}{{ticket.id}} · {{ticket.priority}} · ${copy.closed}
${copy.closedBy}: {{ticket.closedBy}}
${copy.status}: ${copy.closed}
${copy.assignedTo}: {{ticket.assignedDetails}}
${copy.requester}: {{ticket.requesterDetails}}
${copy.category}: {{ticket.categoryPath}}
${copy.location}: {{ticket.locationSummary}}
{{#if ticket.totalTimeWorked}}${copy.totalTimeWorked}: {{ticket.totalTimeWorked}}
{{/if}}{{#if ticket.totalTimeBillable}}${copy.totalBillableTime}: {{ticket.totalTimeBillable}}
{{/if}}{{#if ticket.remainingBlockHours}}${copy.remainingHours}: {{ticket.remainingBlockHours}}
{{/if}}{{#if ticket.assets}}
${copy.devices}:
{{#each ticket.assets}}${copy.deviceName}: {{name}}
${copy.deviceType}: {{assetType}}
${copy.manufacturerModel}: {{manufacturer}} {{model}}
${copy.serialNumber}: {{serialNumber}}

{{/each}}{{/if}}${internal ? `{{#if ticket.materialsTotal}}${copy.materialsTotal}: {{ticket.materialsTotal}}
{{/if}}` : ''}
${copy.resolution}:
{{{ticket.resolution}}}`;
}

function getTemplate(internal) {
  return {
    templateName: internal ? 'ticket-closed-internal' : 'ticket-closed-client',
    subtypeName: internal ? 'Ticket Closed Internal' : 'Ticket Closed Client',
    translations: SUPPORTED_LANGUAGES.map((language) => {
      const copy = copyFor(language);
      return {
        language,
        subject: copy.subject,
        htmlContent: wrapEmailLayout({
          language,
          headerLabel: copy.title,
          headerTitle: '{{ticket.title}}',
          headerMeta: `${copy.ticketNumber}{{ticket.id}} · {{ticket.priority}} · ${copy.closed}`,
          bodyHtml: buildHtml(copy, internal),
          footerText: copy.footer,
        }),
        textContent: buildText(copy, internal),
      };
    }),
  };
}

module.exports = {
  getClientTemplate: () => getTemplate(false),
  getInternalTemplate: () => getTemplate(true),
};
