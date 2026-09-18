/**
 * The pseudo-locale contract, shared by scripts/generate-pseudo-locales.cjs
 * and every test that asserts a key is backed by a pseudo string.
 *
 * A pseudo value is the English source accented character by character and
 * wrapped in locale-specific markers, so it stays readable, stays unique
 * (translated labels get used as React keys) and is unmistakably not English.
 * yy also pads, to surface layout truncation.
 */

export const PSEUDO_LOCALES = {
  xx: { open: '⟦', close: '⟧', expand: 0 },
  yy: { open: '〖', close: '〗', expand: 0.4 },
};

const ACCENTS = {
  a: 'ȧ', b: 'ƀ', c: 'ƈ', d: 'ḓ', e: 'ḗ', f: 'ƒ', g: 'ɠ', h: 'ħ', i: 'ī',
  j: 'ĵ', k: 'ķ', l: 'ŀ', m: 'ḿ', n: 'ƞ', o: 'ȯ', p: 'ƥ', q: 'ʠ', r: 'ř',
  s: 'ş', t: 'ŧ', u: 'ŭ', v: 'ṽ', w: 'ẇ', x: 'ẋ', y: 'ẏ', z: 'ẑ',
  A: 'Ȧ', B: 'Ɓ', C: 'Ƈ', D: 'Ḓ', E: 'Ḗ', F: 'Ƒ', G: 'Ɠ', H: 'Ħ', I: 'Ī',
  J: 'Ĵ', K: 'Ķ', L: 'Ŀ', M: 'Ḿ', N: 'Ƞ', O: 'Ȯ', P: 'Ƥ', Q: 'Ɋ', R: 'Ř',
  S: 'Ş', T: 'Ŧ', U: 'Ŭ', V: 'Ṽ', W: 'Ẇ', X: 'Ẋ', Y: 'Ẏ', Z: 'Ẑ',
};

// {{variable}} tokens and <strong>/<1> markup must survive verbatim.
const PROTECTED = /(\{\{[^}]*\}\}|<\/?[^<>]+>)/g;

function accent(text) {
  let out = '';
  for (const char of text) {
    out += ACCENTS[char] ?? char;
  }
  return out;
}

/** The pseudo string the generator writes for `value` in `locale`. */
export function pseudoString(value, locale = 'xx') {
  const style = PSEUDO_LOCALES[locale];
  if (!style) throw new Error(`Unknown pseudo-locale: ${locale}`);
  if (!value.trim()) return value;

  const body = value
    .split(PROTECTED)
    .map((segment, index) => (index % 2 === 1 ? segment : accent(segment)))
    .join('');

  const padding = style.expand ? ` ${'·'.repeat(Math.ceil(value.length * style.expand))}` : '';
  return `${style.open}${body}${padding}${style.close}`;
}

/** Matches any value the generator produces for `locale`. */
export function pseudoPattern(locale = 'xx') {
  const style = PSEUDO_LOCALES[locale];
  if (!style) throw new Error(`Unknown pseudo-locale: ${locale}`);
  return new RegExp(`^${style.open}[\\s\\S]*${style.close}$`);
}

/** True when `value` is a pseudo string for `locale`. */
export function isPseudoValue(value, locale = 'xx') {
  return typeof value === 'string' && pseudoPattern(locale).test(value);
}
