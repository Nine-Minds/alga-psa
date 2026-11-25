/**
 * The footer row of the shared email layout, as the template sources write it
 * (server/migrations/utils/templates/_shared/emailLayout.cjs):
 *
 *     <tr>
 *       <td style="padding:18px 32px;background:<footerBg>;color:<dark>;font-size:12px;text-align:center;">
 *         Powered by AlgaPSA &middot; Keeping teams aligned
 *       </td>
 *     </tr>
 *
 * Both the attribution strip and the legacy footer repair recognize a footer row
 * by this cell and then remove it whole, so what counts as the cell has to be the
 * exact stock markup, colors aside — the rule `normalizeChangesBox` already holds
 * to. A cell a tenant restyled, or a coloured row they laid out themselves, is
 * none of our business twice over: the strip may not quietly rewrite a footer
 * they typed, and the classifier has to keep seeing that edit, which a row
 * removed from both sides of its comparison would hide (see
 * classifyTenantTemplate.ts).
 *
 * Pinning it leaves nothing behind: every attribution the templates ship sits in
 * this one cell — 441 of the 540 translations in the tree, and the same single
 * shape throughout the history of server/migrations.
 */

const COLOR = String.raw`(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\))`;

/** The stock footer cell, in whatever colors the palette painted it. */
const FOOTER_CELL = String.raw`<tr>\s*<td style="padding:18px 32px;background:${COLOR};color:${COLOR};font-size:12px;text-align:center;">`;

/** The layout's own footer row, around a pattern for what its cell holds. */
export const layoutFooterRow = (content: string): RegExp =>
  new RegExp(`${FOOTER_CELL}\\s*${content}\\s*</td>\\s*</tr>`, 'gi');
