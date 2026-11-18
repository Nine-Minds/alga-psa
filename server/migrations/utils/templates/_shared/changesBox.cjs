/**
 * Shared "Changes Made" box for update emails (ticket-updated, ticket-updated-client,
 * project-updated, project-closed).
 *
 * The subscriber passes structured items ({{#each ticket.changeItems}} /
 * {{#each project.changeItems}}) and this markup owns every color. Brand colors come
 * from the palette constants, so a tenant's email branding rewrites them on apply;
 * the grays are neutral and read on any brand.
 *
 * Item shape: { label, oldValue, newValue, updatedBy, updatedAt }. oldValue is '' when
 * the change has no previous value. updatedBy/updatedAt are set only on the first item
 * of each update in a bundled ticket email, so a heading prints there.
 *
 * The loop is kept flat (no nested {{#each}}) because the template editor preview and
 * the test-email renderer expand only one level.
 */

const {
  BRAND_DARK,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('./constants.cjs');

const OLD_VALUE_COLOR = '#667085';
const FIELD_LABEL_COLOR = '#475467';

/**
 * @param {Object} opts
 * @param {string} opts.label          - Box heading, e.g. "Changes Made"
 * @param {string} opts.itemsPath      - Handlebars path of the items, e.g. "ticket.changeItems"
 * @param {boolean} [opts.grouped]     - Print updater headings (bundled ticket updates)
 */
function buildChangesBoxHtml({ label, itemsPath, grouped = false }) {
  const heading = grouped
    ? `
                  {{#if this.updatedBy}}<div style="font-size:13px;font-weight:600;color:${BRAND_DARK};margin:6px 0 8px 0;">{{this.updatedBy}} <span style="font-weight:500;color:${OLD_VALUE_COLOR};">&middot; {{this.updatedAt}}</span></div>{{/if}}`
    : '';
  return `<div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${label}</div>
                  {{#each ${itemsPath}}}${heading}
                  <div style="margin:0 0 10px 0;">
                    <div style="font-size:13px;font-weight:600;color:${FIELD_LABEL_COLOR};">{{this.label}}</div>
                    {{#if this.oldValue}}<div style="color:${OLD_VALUE_COLOR};text-decoration:line-through;word-break:break-word;">{{this.oldValue}}</div>{{/if}}
                    <div style="color:${BRAND_DARK};font-weight:600;word-break:break-word;">{{this.newValue}}</div>
                  </div>
                  {{/each}}
                </div>`;
}

/**
 * Plain-text counterpart: one "- Field: old → new" line per change.
 */
function buildChangesText({ itemsPath, grouped = false }) {
  const heading = grouped
    ? `{{#if this.updatedBy}}{{this.updatedBy}} · {{this.updatedAt}}
{{/if}}`
    : '';
  return `{{#each ${itemsPath}}}
${heading}- {{this.label}}: {{#if this.oldValue}}{{this.oldValue}} → {{/if}}{{this.newValue}}
{{/each}}`;
}

module.exports = { buildChangesBoxHtml, buildChangesText };
