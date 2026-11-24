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
 * It is also the repair itself, wherever the apply rewrites a row rather than
 * rebuilding it from the standard template: a `customized` row the tenant ticked
 * keeps its own HTML, and the leftover footer in it has no attribution left for
 * `stripBrandAttribution` to find (see `decorateBrandedHtml`). Writer and
 * classifier run the same pass, so a repaired row reads as the one we wrote.
 *
 * The slogan list is the set of lines the template sources and their history
 * ever shipped. Nothing writes an orphaned footer any more, so it needs no
 * entry for a repair that cannot happen; it does need one for every slogan the
 * stock footer carries, because `stripBrandAttribution` reads the same list to
 * tell our own footer row from one a tenant reworded around the attribution
 * (see brandAssets.ts). Were the stock footer ever to ship different wording,
 * it belongs here too, or copies of that template written with the attribution
 * hidden stop reading as ours.
 *
 * A list is unavoidable: a bare slogan in a stored row carries no structural
 * marker that tells it apart from footer text a tenant typed, and blanking
 * footer cells wholesale would clobber hand-edited footers. The empty row needs
 * no list — a cell with nothing in it holds nothing a tenant wrote — only the
 * coloured band's own `background`, which every stock footer cell carries and a
 * content cell does not.
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

/** The shipped slogans as one alternation, shared with the attribution strip. */
export const LEGACY_BRAND_SLOGAN_PATTERN = `(?:${LEGACY_BRAND_SLOGANS.map(escapeRegExp).join('|')})`;

const SLOGAN_ROW = new RegExp(
  `<tr[^>]*>\\s*<td[^>]*>\\s*${LEGACY_BRAND_SLOGAN_PATTERN}\\s*</td>\\s*</tr>`,
  'gi',
);

/**
 * What the old strip left of a footer that was the attribution alone: the
 * coloured band with nothing in it. Tied to the band's own `background` so an
 * emptied content cell, which a tenant may well have cleared on purpose, is not
 * normalized away with it.
 */
const EMPTY_ROW = /<tr[^>]*>\s*<td[^>]*background:[^>]*>\s*<\/td>\s*<\/tr>/gi;

/** Removes a footer row left holding nothing but one of our slogans, or an empty coloured band. */
export function stripOrphanedBrandFooter(html: string): string {
  return html ? html.replace(SLOGAN_ROW, '').replace(EMPTY_ROW, '') : html;
}
