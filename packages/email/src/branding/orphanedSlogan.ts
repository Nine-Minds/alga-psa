/**
 * Legacy repair for the footers an older `stripBrandAttribution` left behind.
 *
 * Until 2026-11 hiding the attribution removed "Powered by AlgaPSA" and the
 * separator but kept what followed, so a branded copy of a layout template
 * ended either on the bare slogan — AlgaPSA's line, in the template's language,
 * reading as an unexplained tagline from the MSP (alga-2026-0003353) — or, where
 * the stock footer was the attribution alone, on an empty coloured band.
 *
 * `stripOrphanedBrandFooter` is the classifier's normalization for those stored
 * rows (like `stripGradientFallback` and `normalizeChangesBox`): both leftovers
 * collapse to nothing, which is what the corrected strip now writes. Such a row
 * therefore still reads as `branded` and is regenerated on the tenant's next
 * apply instead of freezing as a hand customization — which is also what lets
 * turning the attribution back on restore the whole footer.
 *
 * The slogan list is FROZEN: it is the set of lines the template sources and
 * their history ever shipped, and it exists only to recognize rows written
 * before the fix. A new slogan must never be added to it — nothing writes an
 * orphaned footer any more. A list is unavoidable here: a bare slogan in a
 * stored row carries no structural marker that tells it apart from footer text
 * a tenant typed, and blanking footer cells wholesale would clobber hand-edited
 * footers. The empty row needs no list: a cell with nothing in it holds nothing
 * a tenant wrote, and no stock template ships one.
 */

/** Every slogan the stock templates have shipped behind the attribution. */
export const LEGACY_BRAND_SLOGANS: readonly string[] = [
  'Keeping teams aligned',
  'Keep the next action moving',
  'Maintenir les équipes alignées',
  'Gardons les équipes alignées',
  'Faites avancer la prochaine action',
  'Manteniendo a los equipos alineados',
  'Mantenga la próxima acción en marcha',
  'Mantén la próxima acción en marcha',
  'Teams auf Kurs halten',
  'Teams im Einklang halten',
  'Halten Sie die nächste Aktion in Gang',
  'Teams op één lijn houden',
  'Houd de volgende actie in beweging',
  'Manteniamo i team allineati',
  'Mantieni in movimento la prossima azione',
  'Mantendo as equipes alinhadas',
  'Mantenha a próxima ação em movimento',
  'Zespoły zawsze zgrane',
  'Utrzymuj następną akcję w ruchu',
  'För samspelta team',
  'Driv nästa åtgärd framåt',
  'Håller team samordnade',
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SLOGAN_ROW = new RegExp(
  `<tr[^>]*>\\s*<td[^>]*>\\s*(?:${LEGACY_BRAND_SLOGANS.map(escapeRegExp).join('|')})\\s*</td>\\s*</tr>`,
  'gi',
);

/** What the old strip left of a footer that was the attribution alone. */
const EMPTY_ROW = /<tr[^>]*>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/gi;

/** Removes a footer row left holding nothing but one of our slogans, or nothing at all. */
export function stripOrphanedBrandFooter(html: string): string {
  return html ? html.replace(SLOGAN_ROW, '').replace(EMPTY_ROW, '') : html;
}
