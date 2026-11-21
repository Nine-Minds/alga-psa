/**
 * The "Changes Made" box of the update emails (ticket-updated, ticket-updated-client,
 * project-updated, project-closed) moved from a pre-rendered `{{{ticket.changes}}}`
 * fragment to a `{{#each ticket.changeItems}}` loop whose colors the template owns.
 *
 * A tenant row the branding tool wrote before that change still carries the old box,
 * so it no longer equals the branded system template and would read as a hand edit.
 * `normalizeChangesBox` is the classifier's normalization (like
 * `stripGradientFallback`): both forms of the stock box, whatever colors they were
 * painted in, collapse to one marker that keeps the heading text. The tool's own rows
 * therefore stay `branded`, and the next apply rewrites them with the new box.
 *
 * Only the exact stock markup is recognized. A box a tenant restructured or reworded
 * is left as is, so the classifier still reports it as their edit.
 */

const COLOR = String.raw`(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\))`;
const ROOT = String.raw`(ticket|project)`;
const LABEL = String.raw`([^<]*)`;

const BOX_OPEN = String.raw`<div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COLOR};border:1px solid ${COLOR};">\s*<div style="font-weight:600;color:${COLOR};margin-bottom:8px;">${LABEL}</div>\s*`;

/** Before: the subscriber's pre-rendered HTML dropped into the box. */
const LEGACY_BOX = new RegExp(
  BOX_OPEN
    + String.raw`<div style="color:${COLOR};line-height:1\.5;">\{\{\{${ROOT}\.changes\}\}\}</div>\s*</div>`,
  'g',
);

const HEADING = String.raw`(?:\{\{#if this\.updatedBy\}\}<div style="font-size:13px;font-weight:600;color:${COLOR};margin:0 0 8px 0;\{\{#unless @first\}\}margin-top:14px;padding-top:12px;border-top:1px solid ${COLOR};\{\{/unless\}\}">\{\{this\.updatedBy\}\} <span style="font-weight:500;color:${COLOR};">&middot; \{\{this\.updatedAt\}\}</span></div>\{\{/if\}\}\s*)?`;

/** After: the template lays out each item (see server/migrations/utils/templates/_shared/changesBox.cjs). */
const ITEMS_BOX = new RegExp(
  BOX_OPEN
    + String.raw`\{\{#each ${ROOT}\.changeItems\}\}\s*${HEADING}`
    + String.raw`<div style="margin:0 0 10px 0;">\s*`
    + String.raw`<div style="font-size:13px;font-weight:600;color:${COLOR};">\{\{this\.label\}\}</div>\s*`
    + String.raw`\{\{#if this\.oldValue\}\}<div style="color:${COLOR};text-decoration:line-through;word-break:break-word;">\{\{this\.oldValue\}\}</div>\{\{/if\}\}\s*`
    + String.raw`<div style="color:${COLOR};font-weight:600;word-break:break-word;">\{\{this\.newValue\}\}</div>\s*`
    + String.raw`</div>\s*\{\{/each\}\}\s*</div>`,
  'g',
);

const marker = (_match: string, label: string, root: string): string =>
  `<!--changes-box:${root}:${label}-->`;

/** Collapses the stock changes box, in either form and any colors, to a marker. */
export function normalizeChangesBox(html: string): string {
  if (!html || !html.includes('margin:28px 0 16px 0;padding:18px 20px;')) return html;
  return html.replace(LEGACY_BOX, marker).replace(ITEMS_BOX, marker);
}
