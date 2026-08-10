#!/usr/bin/env node

/**
 * Audit UI components for hardcoded English strings that should be translated.
 *
 * The scanner tokenizes each file (comments, strings, template literals and
 * regexes are recognized properly) and then classifies every string-ish value
 * by the *position* it sits in. A finding needs two things: a UI position and
 * text that looks like English prose.
 *
 * Positions that produce a finding
 *   jsx-text     text nodes, including multi-line ones and nodes terminated by
 *                a `{expr}` (>Never<, and the >\n  Activate with claim code\n< shape)
 *   jsx-prop     title/label/placeholder/alt/caption/legend/summary/emptyText/
 *                noDataMessage/submitLabel/okText/… — anything not on the
 *                structural denylist (className/id/href/type/variant/…)
 *   obj-key      `{ label: 'Active' }`, `{ title: 'Description' }`,
 *                `{ header: '…' }`, `{ text: '…' }`, `{ name: '…' }` — column
 *                definitions and option arrays
 *   ternary      `cond ? 'Active' : 'Inactive'`
 *   fallback     `err ?? 'Failed to load…'`, `x || 'Untitled'`
 *   return       `return 'Unknown tier'`, `() => 'Never'`
 *   call-arg     argument of a non-denylisted call — setError('Failed to load…'),
 *                toast.error('…'), setSuccessMsg('…')
 *   array-item   `['Active', 'Inactive']`
 *   assign       `foo = 'Some copy'` outside a JSX tag
 *   template     any of the above holding a backtick string, interpolations
 *                collapsed to `{}` before the prose test
 *
 * Suppressed (kept quiet on purpose)
 *   throw new Error(…), console.*(…), logger.*(…), t(…) — including a t() call
 *   reached through its options object — imports/require, comparisons
 *   (=== 'X', case 'X'), string-key positions, type unions, SVG geometry
 *   (d/points/viewBox), and English values sitting next to a translation key
 *   (`{ labelKey: 'tabs.general', title: 'General' }`).
 *   Not scanned at all: test/story files, app/api/** route handlers (JSON
 *   payloads, translated by whoever renders them) and mock/fixture data.
 *   Not prose: ALL-CAPS masks and format shapes (XXXXXXXX), single letters,
 *   hex colors, tailwind/CSS class strings, URLs, paths and MIME types,
 *   ISO dates and date-format tokens, `displayName = '…'`, 'true'/'false',
 *   digit-heavy blobs, PascalCase/camelCase identifiers, and anything
 *   matching /^[a-z0-9_.-]+$/.
 *
 * Only .tsx files can render JSX — TypeScript rejects JSX in .ts — so the
 * extension gates the JSX heuristics. Without that gate every generic
 * (`Promise<NextResponse>`) reads as a tag and every route handler looks like a
 * component. Non-JSX .ts modules are still scanned for the other positions,
 * because registries and option tables feed the UI too.
 *
 * Severity
 *   A file that renders JSX, has ZERO useTranslation/t() usage, and holds even
 *   one literal in a UI position is reported at the TOP as high severity —
 *   independent of literal count. One literal in a file with no i18n wiring is
 *   worse than eight in a file with a hundred t() calls, because the count only
 *   ever reflects what the heuristics happened to catch.
 *
 * Known limits: the report is a floor, not a census. Copy that reaches the UI
 * from outside the scanned roots (packages/*, server actions, workflow
 * templates, seeded database rows) is invisible here, and a file can be listed
 * as clean while every string in it is English. Brand and enum-ish values
 * ('Google', 'Pro', keyboard key names) are the residual false positives.
 *
 * Usage:
 *   node tools/i18n/find-untranslated-ui.cjs               # top 40 high + top 60 others
 *   node tools/i18n/find-untranslated-ui.cjs --all         # every flagged file
 *   node tools/i18n/find-untranslated-ui.cjs --file=PATH   # detail for one file
 *                                                               # (repo path fragment,
 *                                                               #  or any file on disk —
 *                                                               #  handy for `git show HEAD:x`)
 *   node tools/i18n/find-untranslated-ui.cjs --severity=high     # only "no i18n at all"
 *   node tools/i18n/find-untranslated-ui.cjs --severity=partial  # only the second table
 *   node tools/i18n/find-untranslated-ui.cjs --json        # machine-readable
 */

const fs = require('fs');
const path = require('path');

// Script lives in tools/i18n/, so repo root is two levels up.
const REPO = path.resolve(__dirname, '..', '..');

// Directories to scan for UI components
const ROOTS = [
  'server/src/components',
  'server/src/app',
  'ee/server/src/components',
  'ee/server/src/app',
  // Shared @alga-psa/* packages render most of the product now — Reports,
  // billing, projects, client-portal. Copy here reaches the UI exactly like
  // copy in server/src, so leaving it unscanned meant a whole PR of
  // hardcoded English could pass without the scanner seeing a line.
  'packages',
];

// Never descend into build output or dependencies: packages/*/dist holds a
// compiled copy of the same source, which would double every finding.
const SKIP_DIR = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', 'coverage', '__tests__',
]);

// Files/paths that are structurally excluded from the audit.
// - Tests / stories: not user-facing.
// - UI-kit dev playground (app/msp/test/): internal test harness, never
//   shipped to users.
// - Static legal pages (privacy policy, master terms, etc.): deliberately
//   kept in English because they're contracts — translating without legal
//   review would be worse than leaving them untranslated.
// - API route handlers (app/api/**): they emit JSON error payloads and HTTP
//   headers, not rendered copy. The client that displays a message is what
//   translates it, so flagging `{ error: 'Report not found' }` here is noise.
const SKIP_FILE = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__/,
  /\.stories\.[jt]sx?$/,
  /\/app\/msp\/test\//,
  /\/app\/static\/(privacy_policy|master_terms|terms|legal)\//,
  /\/app\/api\//,
  /(?:^|\/)(?:mock|mocks|fixture|fixtures|__mocks__)[.\-/]/i,
  /mock-?data\.[jt]sx?$/i,
];

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const asJson = args.includes('--json');
// CI gate: exit nonzero when a component renders JSX with no i18n wiring at all.
const failOnHigh = args.includes('--fail-on-high');
const writeUnwiredBaseline = args.includes('--write-unwired-baseline');

// Widening the scan to packages/ surfaced 205 pre-existing unwired components.
// Gating at zero would block every PR, so the gate ratchets instead: files
// already on this list are tracked debt, anything new fails. Delete a line when
// you wire a file up — the gate reports entries that no longer need to be here.
const UNWIRED_BASELINE = path.join(__dirname, 'unwired-baseline.json');
const UNWIRED_NOTE = [
  'TRANSLATION DEBT — a slow burner, not a target to hit in one pass.',
  'Every file here renders JSX without importing useTranslation or calling t(),',
  'so its copy is English in every locale. They predate the scan being widened to',
  'packages/, where most of the product now lives; gating at zero would have',
  'blocked every PR, so the gate ratchets against this list instead: these are',
  'known debt, anything new fails.',
  'Chip away at it — delete a line when you wire a file up, and the gate will',
  'tell you when an entry no longer belongs here. Do not add to it to make a',
  'build pass; regenerate deliberately with --write-unwired-baseline.',
  'packages/client-portal is the place to start: customer-facing, and the',
  'smallest of the large buckets.',
].join(' ');
function loadUnwiredBaseline() {
  try {
    return new Set(JSON.parse(fs.readFileSync(UNWIRED_BASELINE, 'utf8')).files);
  } catch {
    return new Set();
  }
}
const fileFilter = (args.find((a) => a.startsWith('--file=')) || '').replace('--file=', '');
const severity = (args.find((a) => a.startsWith('--severity=')) || '').replace('--severity=', '') || 'all';
if (!['all', 'high', 'partial'].includes(severity)) {
  console.error(`--severity must be one of: all, high, partial (got "${severity}")`);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

// Produces:
//   code    source with comment bodies blanked (line structure preserved)
//   bare    `code` with string / template / regex bodies blanked too — used for
//           every structural lookaround so quoted punctuation never confuses it
//   strings every string + template literal, with its display text
function tokenize(src) {
  const N = src.length;
  const code = Array.from(src);
  const bare = Array.from(src);
  const strings = [];
  let prev = '';
  let prevWord = '';

  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < N; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  // `prev` is the last significant char; `prevWord` the last complete word, kept
  // across the whitespace that separates it from what follows (`return /re/`).
  const noteChar = (ch) => {
    if (/[A-Za-z_$0-9]/.test(ch)) { prevWord = /[A-Za-z_$0-9]/.test(prev) ? prevWord + ch : ch; }
    else if (!/\s/.test(ch)) prevWord = '';
    if (!/\s/.test(ch)) prev = ch;
  };

  // A `/` starts a regex only after an operator, an opening bracket, or a
  // keyword. After an identifier, number, `)` or `]` it is division.
  const REGEX_OK_PREV = /[(,=:[!&|?{};+\-*%~^]/;
  const REGEX_OK_WORD = /^(return|typeof|instanceof|in|of|case|delete|void|do|else|yield|await|new)$/;

  function readLineComment(i) {
    let j = i;
    while (j < N && src[j] !== '\n') j++;
    blank(code, i, j);
    blank(bare, i, j);
    return j;
  }

  function readBlockComment(i) {
    let j = i + 2;
    while (j < N && !(src[j] === '*' && src[j + 1] === '/')) j++;
    j = Math.min(N, j + 2);
    blank(code, i, j);
    blank(bare, i, j);
    return j;
  }

  // Quotes that never close on their line are not strings — most often an
  // apostrophe sitting in a JSX text node (`<p>Don't</p>`).
  function readString(i) {
    const q = src[i];
    let j = i + 1;
    while (j < N) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === q || src[j] === '\n') break;
      j++;
    }
    if (j >= N || src[j] !== q) return i + 1;
    const raw = src.slice(i + 1, j);
    strings.push({ start: i, end: j + 1, kindOfLiteral: 'string', display: unescapeLiteral(raw) });
    blank(bare, i + 1, j);
    return j + 1;
  }

  function readTemplate(i) {
    let j = i + 1;
    let chunkStart = j;
    const parts = [];
    let interpolated = false;
    while (j < N) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') break;
      if (c === '$' && src[j + 1] === '{') {
        parts.push(src.slice(chunkStart, j));
        interpolated = true;
        blank(bare, chunkStart, j);
        const close = scan(j + 2, true);
        j = Math.min(N, close + 1);
        chunkStart = j;
        continue;
      }
      j++;
    }
    parts.push(src.slice(chunkStart, Math.min(j, N)));
    blank(bare, chunkStart, Math.min(j, N));
    strings.push({
      start: i,
      end: Math.min(N, j + 1),
      kindOfLiteral: 'template',
      interpolated,
      display: parts.map(unescapeLiteral).join('{}'),
    });
    return Math.min(N, j + 1);
  }

  // A regex that does not close on its line is treated as division instead —
  // a misread here would blank real code.
  function readRegex(i) {
    let j = i + 1;
    let inClass = false;
    while (j < N) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') return -1;
      if (inClass) { if (c === ']') inClass = false; }
      else if (c === '[') inClass = true;
      else if (c === '/') break;
      j++;
    }
    if (j >= N || src[j] !== '/') return -1;
    blank(bare, i + 1, j);
    return j + 1;
  }

  // Walks code from `i`. With stopAtBrace, returns the index of the `}` that
  // closes the current `${` interpolation.
  function scan(i, stopAtBrace) {
    let depth = 0;
    while (i < N) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { i = readLineComment(i); continue; }
      if (c === '/' && src[i + 1] === '*') { i = readBlockComment(i); continue; }
      if (c === '"' || c === "'") { const next = readString(i); prev = '"'; prevWord = ''; i = next; continue; }
      if (c === '`') { i = readTemplate(i); prev = '`'; prevWord = ''; continue; }
      if (c === '/' && (REGEX_OK_PREV.test(prev) || REGEX_OK_WORD.test(prevWord) || prev === '')) {
        const next = readRegex(i);
        if (next > 0) { prev = '/'; prevWord = ''; i = next; continue; }
      }
      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return i; depth--; }
      }
      noteChar(c);
      i++;
    }
    return i;
  }

  scan(0, false);
  strings.sort((a, b) => a.start - b.start);
  return { code: code.join(''), bare: bare.join(''), strings };
}

function unescapeLiteral(raw) {
  return raw
    .replace(/\\r/g, '')
    .replace(/\\[nt]/g, ' ')
    .replace(/\\u\{?([0-9a-fA-F]{4,6})\}?/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/\\(.)/g, '$1');
}

/* ------------------------------------------------------------------ *
 * Prose classifier — "is this English copy, or is it code?"
 * ------------------------------------------------------------------ */

// Anything outside this set is code: `_`, `=`, `{}`, `<>`, `$`, `@`, `*`, `\`,
// `|`, `+`, `[]`, backticks. Kept: sentence punctuation, quotes, dashes, `/`,
// `#`, `%`, `&` (HTML entities).
const PROSE_CHARSET = /^[\p{L}\p{N} .,!?;:'’‘"“”()&%/#\-–—…°€$£¥]+$/u;

const STOPWORDS = new Set(
  ('a an the and or but if then else of to in on at by for with from as is are was were be been ' +
   'being do does did done have has had not no yes you your yours we our us they their there this ' +
   'that these those it its can could should would will shall may might must please when while ' +
   'here how what which who whom whose all any some each every more most other than into over ' +
   'under out up down again once only own same so too very just now new none per about after ' +
   'before between during without within because since until unless already still yet also both ' +
   'either neither cannot don’t doesn’t didn’t isn’t aren’t won’t')
    .split(/\s+/)
);

// Technical tokens that pass the shape tests but are never UI copy.
const TECH_TOKENS = new Set([
  'Bearer', 'Basic', 'Authorization', 'Infinity', 'NaN', 'Object', 'Array', 'Boolean', 'Promise',
  'Symbol', 'React', 'Node', 'Next', 'Cookie', 'Referer', 'Origin', 'Host', 'Etag', 'Accept',
  'Connection', 'Upgrade', 'Buffer', 'Blob', 'Number', 'String', 'Function', 'Math', 'Intl',
]);

// The `>…<` sweep also runs over ordinary code in .tsx files, where generics
// (`React.FC<Props>`, `Readonly<{…}>`) put declaration syntax between angle
// brackets. Case-sensitive on purpose: `void`/`Void` and `class`/`Class` differ.
const CODE_KEYWORD_RE =
  /\b(?:interface|export|import|const|let|var|function|extends|implements|readonly|enum|declare|namespace|satisfies|keyof|typeof|instanceof|async|await|null|undefined|void|Readonly|Promise|ReactNode|ReactElement|JSX|PropsWithChildren)\b/;

const DATE_TOKEN_RE = /(MM|DD|YY|HH|hh|mm|ss|SSS|Do|dddd|MMM|ZZ|xxx)/;
const DATE_SHAPE_RE = /^[MDYHhmsSAaZzTWwQqEeGgXx\d\s\-/:.,'[\]]+$/;

// Returns the normalized text if it reads as UI copy, otherwise null.
function proseText(input, opts = {}) {
  if (input == null) return null;
  // `{}` marks a collapsed template interpolation; ignore it for shape tests.
  const withPlaceholders = String(input).replace(/\s+/g, ' ').trim();
  const s = withPlaceholders;
  if (!s) return null;
  const bare = s.replace(/\{\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (bare.length < 2) return null;
  if (!PROSE_CHARSET.test(bare)) return null;
  if (!/\p{Ll}/u.test(bare)) return null;                    // ALL-CAPS masks: XXXXXXXX, API, ID
  if ((bare.match(/\p{L}/gu) || []).length < 2) return null;  // single letters / symbols
  if (TECH_TOKENS.has(bare)) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(bare)) return null;          // hex color
  if (/^(?:https?:|mailto:|tel:|ftp:|data:|www\.|\/|\.\/|\.\.\/|#\/|@)/i.test(bare)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(bare)) return null;           // ISO date
  if (DATE_SHAPE_RE.test(bare) && DATE_TOKEN_RE.test(bare)) return null; // format tokens

  const hasSpace = /\s/.test(bare);
  if (!hasSpace) {
    if (/[/#]/.test(bare)) return null;                       // paths, fragments
    if (/\p{Ll}\p{Lu}/u.test(bare)) return null;              // camelCase / PascalCase identifiers
    if (/\p{L}\.\p{L}/u.test(bare)) return null;              // dotted keys: Common.Save
    if (/-/.test(bare) && (bare.match(/\p{Lu}/gu) || []).length > 1) return null; // Content-Type
    if (/^[a-z0-9_.-]+$/.test(bare)) return null;             // plain identifier
  }
  if (/[_=<>{}\\|]/.test(bare)) return null;
  // A lowercase-initial word with an internal capital is an identifier that
  // leaked in from code (`lastUsedAfter`, `selfHostMode`) — never copy.
  if (/(?:^|[^\p{L}])\p{Ll}+\p{Lu}/u.test(bare)) return null;
  // No capital anywhere plus a hyphen is a CSS/tailwind class list
  // (`transition-all duration-300 ease-in-out`), never a sentence.
  if (!/\p{Lu}/u.test(bare) && /-/.test(bare)) return null;
  // SVG path data, coordinate blobs, id-like blobs.
  if ((bare.match(/[\d.]/g) || []).length > bare.length * 0.35) return null;
  for (const token of bare.split(/\s+/)) {
    if (/\//.test(token) && !/\p{Lu}/u.test(token)) return null;   // application/json, src/lib
    if (/-/.test(token) && (token.match(/\p{Lu}/gu) || []).length > 1) return null; // Content-Type
  }

  // Accept if it carries a Capitalized word, or reads as a lowercase English
  // phrase (needed for interpolated copy like `${tier} is active`).
  const capitalWord = /(?:^|[\s"'“‘([\-–—/])\p{Lu}\p{Ll}/u.test(bare);
  const words = (bare.toLowerCase().match(/[\p{L}’']+/gu) || []);
  const stops = words.filter((w) => STOPWORDS.has(w)).length;
  const englishPhrase = words.length >= 2 && stops >= 1;
  if (!capitalWord && !englishPhrase) return null;

  if (opts.jsxText) {
    if (/&&|\|\|/.test(bare)) return null;                    // `a && <B/>` leaking through
    if (/;/.test(bare) && !/&[a-zA-Z#0-9]+;/.test(bare)) return null;
    if (/^[:;,.=+*!?)\]]/.test(bare)) return null;            // `}: Readonly<…>` tails
    if (CODE_KEYWORD_RE.test(bare)) return null;              // declarations next to generics
    if (/\p{L}\.\p{Lu}/u.test(bare)) return null;             // React.FC, Foo.Bar
    const opens = (bare.match(/\(/g) || []).length;
    const closes = (bare.match(/\)/g) || []).length;
    if (opens !== closes) return null;
    // The `>…<` scan sweeps over ordinary code too, so a bare lowercase phrase
    // is only believable here when it is long enough to be a real sentence.
    if (!capitalWord && !(words.length >= 4 && stops >= 2)) return null;
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Position classification
 * ------------------------------------------------------------------ */

// Call targets whose string arguments are never user-facing copy.
const DENY_CALL = new Set([
  'require', 'import', 't', 'i18n.t', 'i18next.t', 'translate', 'tt', 'key', 'useTranslation',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'AggregateError', 'assert', 'invariant',
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'classNames', 'clsx', 'cn', 'twMerge', 'cva', 'clsxm',
  'Symbol', 'BigInt', 'Date', 'parseInt', 'parseFloat', 'Number', 'String', 'Boolean',
  'JSON.parse', 'JSON.stringify', 'Object.keys', 'Object.assign',
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'join', 'replace',
  'replaceAll', 'match', 'matchAll', 'search', 'localeCompare', 'padStart', 'padEnd', 'repeat',
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'createElement',
  'setAttribute', 'getAttribute', 'removeAttribute', 'addEventListener', 'removeEventListener',
  'matchMedia', 'createContext', 'z.enum', 'z.literal', 'raw', 'knex.raw', 'sql',
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'URL', 'URLSearchParams', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
  'push', 'replaceState', 'pushState', 'redirect', 'revalidatePath', 'revalidateTag',
  'getItem', 'setItem', 'removeItem', 'emit', 'publish', 'subscribe', 'track', 'capture',
]);
// Dotted callees whose *object* is enough to deny: console.*, logger.*, …
const DENY_CALL_OBJECT = /^(console|logger|log|winston|pino|debug|analytics|posthog|Sentry|localStorage|sessionStorage|process|performance|crypto|window\.localStorage)\./;

// Prop / object-key names that hold structure, ids, enums or styling.
const DENY_NAME = new Set([
  'classname', 'class', 'id', 'key', 'ref', 'href', 'src', 'srcset', 'type', 'variant', 'size',
  'color', 'colour', 'style', 'htmlfor', 'role', 'target', 'rel', 'method', 'action', 'actiontype',
  'value', 'defaultvalue', 'checked', 'dataindex', 'datakey', 'accessor', 'accessorkey', 'field',
  'fieldname', 'column', 'columnkey', 'width', 'height', 'minwidth', 'maxwidth', 'minheight',
  'maxheight', 'fill', 'stroke', 'viewbox', 'xmlns', 'points', 'transform', 'd', 'cx', 'cy', 'r', 'x', 'y', 'path', 'pathname',
  'route', 'to', 'from', 'url', 'uri', 'endpoint', 'api', 'namespace', 'ns', 'entity',
  'entitytype', 'resource', 'resourcetype', 'table', 'tablename', 'collection', 'model',
  'provider', 'driver', 'adapter', 'mode', 'layout', 'position', 'align', 'alignment', 'side',
  'placement', 'direction', 'order', 'sortby', 'sortorder', 'orderby', 'groupby', 'groupkey',
  'format', 'dateformat', 'locale', 'language', 'lang', 'currency', 'currencycode', 'countrycode',
  'timezone', 'tz', 'permission', 'permissions', 'scope', 'scopes', 'event', 'eventtype', 'kind',
  'level', 'severity', 'status', 'state', 'tone', 'theme', 'icon', 'iconname', 'image', 'avatar',
  'logo', 'testid', 'datatestid', 'displayname', 'slug', 'code', 'token', 'secret', 'env',
  'environment', 'version', 'tag', 'tags', 'operator', 'comparator', 'condition', 'selector',
  'component', 'element', 'tagname', 'as', 'autocomplete', 'inputmode', 'pattern', 'accept',
  'enctype', 'charset', 'encoding', 'mimetype', 'contenttype', 'extension', 'ext', 'algorithm',
  'hash', 'protocol', 'host', 'hostname', 'port', 'domain', 'region', 'bucket', 'queue', 'topic',
  'channel', 'stream', 'cron', 'schedule', 'interval', 'unit', 'delimiter', 'separator',
]);

function isDeniedName(rawName) {
  if (!rawName) return false;
  const name = rawName.toLowerCase().replace(/^.*\./, '');
  if (DENY_NAME.has(name)) return true;
  if (name.startsWith('data-')) return true;
  if (name.startsWith('aria-')) {
    return !['aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'aria-roledescription'].includes(name);
  }
  if (name.startsWith('on') && /^on[A-Z]/.test(rawName.replace(/^.*\./, ''))) return true;
  return false;
}

// Nearest unclosed bracket before `idx`, plus whatever names it.
function enclosingContext(bare, idx) {
  let depth = 0;
  const floor = Math.max(0, idx - 20000);
  for (let i = idx - 1; i >= floor; i--) {
    const c = bare[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) {
        const before = bare.slice(Math.max(0, i - 120), i);
        if (c === '(') {
          const m = before.match(/([\w$.]+)\s*$/);
          const callee = m ? m[1] : '';
          const isNew = /\bnew\s+[\w$.]*$/.test(before);
          return { open: '(', callee, isNew, index: i };
        }
        if (c === '{') {
          const p = before.match(/([\w$.:-]+)\s*=\s*$/);
          return { open: '{', propName: p ? p[1] : '', index: i };
        }
        return { open: '[', index: i };
      }
      depth--;
    }
  }
  return { open: '' };
}

// Is `idx` inside the attribute list of a JSX tag?
function insideJsxTag(bare, idx) {
  let depth = 0;
  const floor = Math.max(0, idx - 4000);
  for (let i = idx - 1; i >= floor; i--) {
    const c = bare[i];
    if (c === ')' || c === ']' || c === '}') { depth++; continue; }
    if (c === '(' || c === '[' || c === '{') { if (depth === 0) return false; depth--; continue; }
    if (depth > 0) continue;
    if (c === ';') return false;
    if (c === '>') return bare[i - 1] === '=';       // `=>` is not a tag close
    if (c === '<') return /[A-Za-z/]/.test(bare[i + 1] || '');
  }
  return false;
}

// Does the `:` at the end of `before` belong to a ternary rather than a key?
function isTernaryColon(before) {
  let depth = 0;
  for (let i = before.length - 2; i >= 0 && i > before.length - 400; i--) {
    const c = before[i];
    if (c === ')' || c === ']' || c === '}') { depth++; continue; }
    if (c === '(' || c === '[' || c === '{') { if (depth === 0) return false; depth--; continue; }
    if (depth > 0) continue;
    if (c === ';') return false;
    if (c === ',') return false;
    if (c === '?') {
      if (before[i - 1] === '?' || before[i + 1] === '?' || before[i + 1] === '.') continue;
      return true;
    }
  }
  return false;
}

// `{ id: 'general', labelKey: 'tabs.general', title: 'General' }` — the English
// value is a fallback next to a translation key, not untranslated copy.
const I18N_KEY_SIBLING = /\b\w*(?:label|title|name|text|description|message|heading|tooltip|i18n|translation)Key\s*:/i;
function hasI18nKeySibling(bare, start) {
  let depth = 0;
  let open = -1;
  for (let i = start - 1; i >= 0 && start - i < 4000; i--) {
    const c = bare[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) { open = i; break; } depth--; }
  }
  if (open < 0) return false;
  depth = 0;
  let close = bare.length;
  for (let i = open + 1; i < bare.length && i - open < 4000; i++) {
    const c = bare[i];
    if (c === '{') depth++;
    else if (c === '}') { if (depth === 0) { close = i; break; } depth--; }
  }
  return I18N_KEY_SIBLING.test(bare.slice(open, close));
}

// Returns { kind, detail } for a literal at `start`, or null to suppress it.
function classifyPosition(bare, start, src) {
  const before = bare.slice(Math.max(0, start - 220), start).replace(/\s+$/, '');
  // String bodies are blanked in `bare`, so a quoted key ('client-portal':)
  // has to be read back out of the original source.
  const rawBefore = (src || bare).slice(Math.max(0, start - 220), start).replace(/\s+$/, '');
  const ctx = enclosingContext(bare, start);

  // Walk outward, not just one level: `t('key', { provider: x ? 'Google' : … })`
  // hides the denied `t(` call behind an options object.
  let at = start;
  for (let level = 0; level < 5; level++) {
    const outer = enclosingContext(bare, at);
    if (!outer.open || outer.index == null) break;
    if (outer.open === '(') {
      const callee = outer.callee || '';
      const method = callee.replace(/^.*\./, '');
      if (DENY_CALL.has(callee) || DENY_CALL.has(method) || DENY_CALL_OBJECT.test(callee)) return null;
      if (outer.isNew && /Error$/.test(callee)) return null;
      if (/(^|\.)t$/.test(callee)) return null;
    }
    at = outer.index;
  }
  if (ctx.open === '{' && isDeniedName(ctx.propName)) return null;

  const lineStart = bare.lastIndexOf('\n', start) + 1;
  if (/^\s*(import|export)\b/.test(bare.slice(lineStart, start))) return null;
  if (/\bfrom\s*$/.test(before)) return null;
  if (/\bcase\s*$/.test(before)) return null;
  if (/(===|!==|==|!=)\s*$/.test(before)) return null;
  if (/(?:^|[^|])\|\s*$/.test(before)) return null;         // type union `'a' | 'b'`
  if (/\b(?:satisfies|keyof|typeof)\s*$/.test(before)) return null;

  if (/\?\?\s*$/.test(before)) return { kind: 'fallback', detail: '?? default' };
  if (/\|\|\s*$/.test(before)) return { kind: 'fallback', detail: '|| default' };
  if (/(?:^|[^?.])\?\s*$/.test(before)) return { kind: 'ternary', detail: 'ternary branch' };
  if (/\breturn\s*$/.test(before)) return { kind: 'return', detail: 'returned value' };
  if (/=>\s*$/.test(before)) return { kind: 'return', detail: 'arrow return' };

  if (/[^=!<>+\-*/%&|^]:\s*$|^:\s*$/.test(before) || /(?:^|[\s{,([])[\w$'"]+\s*:\s*$/.test(before)) {
    if (isTernaryColon(before)) return { kind: 'ternary', detail: 'ternary branch' };
    const m = before.match(/(?:^|[\s{,([])(['"]?)([\w$-]+)\1\s*:\s*$/)
      || rawBefore.match(/(?:^|[\s{,([])(['"]?)([\w$-]+)\1\s*:\s*$/);
    const name = m ? m[2] : '';
    if (isDeniedName(name)) return null;
    if (hasI18nKeySibling(bare, start)) return null;
    return { kind: 'obj-key', detail: `${name || '?'}:` };
  }

  if (/=\s*$/.test(before)) {
    const m = before.match(/([\w$.:-]+)\s*=\s*$/);
    const name = m ? m[1] : '';
    if (isDeniedName(name)) return null;
    if (/displayname$/i.test(name.replace(/^.*\./, ''))) return null;
    return insideJsxTag(bare, start)
      ? { kind: 'jsx-prop', detail: `${name}=` }
      : { kind: 'assign', detail: `${name} =` };
  }

  if (/[,(]\s*$/.test(before) && ctx.open === '(') {
    const callee = ctx.callee || '(anonymous)';
    const uiCall = /^(toast|alert|confirm|notify|snackbar)/i.test(callee) || /^set[A-Z]/.test(callee);
    return { kind: uiCall ? 'ui-call' : 'call-arg', detail: `${callee}(…)` };
  }
  if (/[,[]\s*$/.test(before) && ctx.open === '[') return { kind: 'array-item', detail: 'array item' };
  if (/\{\s*$/.test(before) && ctx.open === '{') {
    return { kind: 'jsx-expr', detail: ctx.propName ? `${ctx.propName}={…}` : 'expression' };
  }
  if (/[+]\s*$/.test(before)) return { kind: 'concat', detail: 'concatenation' };
  return null;
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

const T_CALL_RE = /\bt\s*\(\s*['"`]|\bt\.rich\s*\(/g;
const USE_T_RE = /\b(?:useTranslation|useTranslations|withTranslation|getTranslations?|getServerTranslation|getFixedT)\s*\(|<Trans[\s/>]/;
// `>text<` and `>text{` and `}text<` — newlines allowed, so multi-line nodes count.
const JSX_TEXT_RE = /[>}]([^<>{}]+)[<{]/g;

// TypeScript only parses JSX in .tsx, so the extension is a hard gate. Without
// it, generics (`Promise<NextResponse>`, `interface Ctx`) read as JSX and every
// API route handler lands in the report as a UI component.
// Lowercase tag names are only JSX if they are real HTML elements; anything
// else lowercase after `<` is a generic type argument (`Record<string, …>`).
const HTML_TAGS = new Set(
  ('a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas ' +
   'caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed ' +
   'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe ' +
   'img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol ' +
   'optgroup option output p param picture pre progress q rp rt ruby s samp script section select ' +
   'slot small source span strong style sub summary sup table tbody td template textarea tfoot th ' +
   'thead time title tr track u ul var video wbr svg path circle rect g line polyline polygon ' +
   'defs clipPath mask pattern text tspan use symbol').split(/\s+/)
);

function opensJsxTag(bare, idx) {
  const m = /^<(\/?)([A-Za-z][\w.-]*)/.exec(bare.slice(idx, idx + 60));
  if (!m) return false;
  if (m[1] === '/') return true;
  const tag = m[2];
  return /^[A-Z]/.test(tag) || HTML_TAGS.has(tag);
}

function hasJsx(src, file) {
  if (!/\.tsx$/.test(file || '')) return false;
  return /<[A-Za-z][\w.]*[\s/>]/.test(src) || /return\s*\(\s*</.test(src);
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

function analyze(src) {
  const { bare, strings } = tokenize(src);
  const lineOf = lineIndex(src);
  const findings = [];
  const seen = new Set();

  const add = (kind, detail, text, idx) => {
    const line = lineOf(idx);
    const key = `${line}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, detail, text, line });
  };

  for (const tok of strings) {
    const text = proseText(tok.display);
    if (!text) continue;
    const pos = classifyPosition(bare, tok.start, src);
    if (!pos) continue;
    const kind = tok.kindOfLiteral === 'template' ? `template/${pos.kind}` : pos.kind;
    add(kind, pos.detail, text, tok.start);
  }

  JSX_TEXT_RE.lastIndex = 0;
  let m;
  while ((m = JSX_TEXT_RE.exec(bare)) !== null) {
    JSX_TEXT_RE.lastIndex = m.index + m[0].length - 1;
    // Only count it when the opener really closed a tag or an expression.
    if (bare[m.index] === '>' && bare[m.index - 1] === '=') continue;   // arrow function
    // …and when the terminator really opens one. `return parsed as Record<string,
    // unknown>` otherwise reads as a text node followed by a `<string>` tag.
    const closeAt = m.index + m[0].length - 1;
    if (bare[closeAt] === '<' && !opensJsxTag(bare, closeAt)) continue;
    // Judge the blanked capture, never the raw slice: inside a template literal
    // the chunks are spaces in `bare`, and reading the original text back would
    // resurrect console.warn copy as a "text node".
    const text = proseText(m[1], { jsxText: true });
    if (!text) continue;
    add('jsx-text', 'JSX text node', text, m.index + 1);
  }

  findings.sort((a, b) => a.line - b.line);

  const tCalls = (src.match(T_CALL_RE) || []).length;
  const useT = USE_T_RE.test(src);
  return { findings, tCalls, useT };
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(full, out);
    }
    else if (/\.(tsx|ts)$/.test(entry.name)) {
      if (SKIP_FILE.some((re) => re.test(full))) continue;
      out.push(full);
    }
  }
  return out;
}

const allFiles = ROOTS.flatMap((r) => walk(path.join(REPO, r)));

if (fileFilter) {
  const direct = path.resolve(process.cwd(), fileFilter);
  const match = fs.existsSync(direct) && fs.statSync(direct).isFile()
    ? direct
    : allFiles.find((f) => f.includes(fileFilter));
  if (!match) {
    console.error(`No file matched: ${fileFilter}`);
    process.exit(1);
  }
  const src = fs.readFileSync(match, 'utf8');
  const { findings, tCalls, useT } = analyze(src);
  const rel = match.startsWith(REPO) ? path.relative(REPO, match) : match;
  const jsx = hasJsx(src, match);
  console.log(`# ${rel}\n`);
  console.log(`- renders JSX:    ${jsx ? 'yes' : 'no'}`);
  console.log(`- useTranslation: ${useT ? 'yes' : 'NO'}`);
  console.log(`- t() calls:      ${tCalls}`);
  console.log(`- literals:       ${findings.length}`);
  if (jsx && !useT && tCalls === 0 && findings.length > 0) {
    console.log(`- severity:       HIGH — renders JSX with no i18n wiring at all`);
  }
  console.log('');
  const byKind = findings.reduce((acc, f) => { (acc[f.kind] ||= []).push(f); return acc; }, {});
  for (const [kind, items] of Object.entries(byKind)) {
    console.log(`## ${kind} (${items.length})`);
    for (const f of items) console.log(`  L${f.line}  [${f.detail}]  ${f.text}`);
    console.log('');
  }
  process.exit(0);
}

const results = [];
for (const file of allFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const jsx = hasJsx(src, file);
  const { findings, tCalls, useT } = analyze(src);
  if (findings.length === 0) continue;
  results.push({
    file,
    rel: path.relative(REPO, file),
    jsx,
    useT,
    tCalls,
    findings,
    noI18n: jsx && !useT && tCalls === 0,
  });
}

const high = results.filter((r) => r.noI18n).sort((a, b) => b.findings.length - a.findings.length);
// Everything else: rank by literals, with a little credit for existing t().
const partial = results
  .filter((r) => !r.noI18n)
  .sort((a, b) => {
    const score = (r) => r.findings.length - Math.min(r.tCalls, r.findings.length) * 0.25;
    return score(b) - score(a);
  });

const totalLiterals = results.reduce((n, r) => n + r.findings.length, 0);

if (asJson) {
  console.log(JSON.stringify({
    scanned: allFiles.length,
    flagged: results.length,
    literals: totalLiterals,
    high: high.map((r) => ({ file: r.rel, literals: r.findings.length, findings: r.findings })),
    partial: partial.map((r) => ({ file: r.rel, jsx: r.jsx, useT: r.useT, tCalls: r.tCalls, literals: r.findings.length, findings: r.findings })),
  }, null, 2));
  process.exit(failOnHigh && high.length > 0 ? 1 : 0);
}

// CI mode. Only the high-severity list is gated: a file that renders JSX with
// no i18n wiring at all is unambiguous, while the `partial` list carries the
// residual false positives the legend describes (brand names, enum-ish values,
// CSS strings) and would make a gate meaningless.
if (writeUnwiredBaseline) {
  const files = high.map((r) => r.rel).sort();
  fs.writeFileSync(UNWIRED_BASELINE, `${JSON.stringify({ note: UNWIRED_NOTE, files }, null, 2)}\n`);
  console.log(`Wrote ${files.length} file(s) to ${path.relative(REPO, UNWIRED_BASELINE)}`);
  process.exit(0);
}

if (failOnHigh) {
  const baseline = loadUnwiredBaseline();
  const fresh = high.filter((r) => !baseline.has(r.rel));
  const stillListed = new Set(high.map((r) => r.rel));
  const fixed = [...baseline].filter((f) => !stillListed.has(f)).sort();

  console.log(`Scanned ${allFiles.length} files across ${ROOTS.length} roots.`);
  console.log(`${high.length} unwired component(s); ${baseline.size} are known debt on the baseline.\n`);

  if (fixed.length) {
    console.log(`${fixed.length} baseline entr(y/ies) no longer unwired — drop them with --write-unwired-baseline:`);
    for (const f of fixed) console.log(`  ${f}`);
    console.log('');
  }

  if (fresh.length === 0) {
    console.log('No newly unwired components.\n\nPASSED');
    process.exit(0);
  }

  console.log(`${fresh.length} file(s) newly render JSX with no i18n wiring at all:\n`);
  for (const result of fresh) {
    console.log(`  ${result.rel} (${result.findings.length} literal(s), first: L${result.findings[0].line} ${result.findings[0].text.slice(0, 80)})`);
  }
  console.log('\nWire them up, or run --write-unwired-baseline if this is deliberate.\n\nFAILED');
  process.exit(1);
}

function kindSummary(findings) {
  const counts = findings.reduce((acc, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc; }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}

const esc = (s) => String(s).slice(0, 78).replace(/\|/g, '\\|');

console.log('# Untranslated UI audit\n');
console.log(
  `Scanned ${allFiles.length} files across ${ROOTS.length} roots. ` +
    `Flagged ${results.length} files holding ${totalLiterals} hardcoded literals — ` +
    `${high.length} render JSX with no i18n wiring at all, ${partial.length} others.\n`
);

if (severity !== 'partial') {
  console.log('## High severity — no i18n at all\n');
  console.log(
    'These files render JSX, never import `useTranslation`, and never call `t()`. ' +
      'The literal count is a floor, not a measurement: with no i18n wiring the whole ' +
      'file is English, and the heuristics only see the shapes they know. Treat every ' +
      'one of these as a full-file translation pass regardless of the number.\n'
  );
  if (high.length === 0) {
    console.log('_None._\n');
  } else {
    const limit = showAll ? high.length : Math.min(40, high.length);
    console.log('| # | File | literals | why | flagged shapes |');
    console.log('|---|------|----------|-----|----------------|');
    for (let i = 0; i < limit; i++) {
      const r = high[i];
      console.log(
        `| ${i + 1} | ${r.rel} | ${r.findings.length} | renders JSX, no \`useTranslation\`, 0 \`t()\` calls | ${esc(kindSummary(r.findings))} |`
      );
    }
    if (limit < high.length) console.log(`\n_(${high.length - limit} more — rerun with \`--all\`.)_`);
    console.log('\n### Samples\n');
    for (let i = 0; i < Math.min(limit, 15); i++) {
      const r = high[i];
      console.log(`**${r.rel}**`);
      for (const f of r.findings.slice(0, 8)) {
        console.log(`- L${f.line} \`${f.kind}\` [${f.detail}] — ${f.text.slice(0, 110)}`);
      }
      if (r.findings.length > 8) console.log(`- …and ${r.findings.length - 8} more`);
      console.log('');
    }
  }
}

if (severity !== 'high') {
  console.log('## Other files with hardcoded literals\n');
  console.log(
    'Partially-translated components (i18n wired, copy left behind) plus non-JSX ' +
      'modules — registries, option tables, helpers — whose strings reach the UI ' +
      'through a component.\n'
  );
  if (partial.length === 0) {
    console.log('_None._\n');
  } else {
    const limit = showAll ? partial.length : Math.min(60, partial.length);
    console.log(`Showing ${limit} of ${partial.length}.\n`);
    console.log('| # | File | JSX | useT | t() | literals | flagged shapes | sample |');
    console.log('|---|------|-----|------|-----|----------|----------------|--------|');
    for (let i = 0; i < limit; i++) {
      const r = partial[i];
      const first = r.findings[0];
      console.log(
        `| ${i + 1} | ${r.rel} | ${r.jsx ? 'yes' : 'no'} | ${r.useT ? 'yes' : '**NO**'} | ${r.tCalls} | ${r.findings.length} | ${esc(kindSummary(r.findings))} | L${first.line} ${esc(first.text)} |`
      );
    }
    if (limit < partial.length) console.log(`\n_(${partial.length - limit} more — rerun with \`--all\`.)_`);
  }
}

console.log('\n## Legend\n');
console.log('- **High severity**: JSX + zero `useTranslation`/`t()`. Ranking by literal count would bury these — a file with one detected literal and no i18n import is worse than one with eight literals and a hundred `t()` calls.');
console.log('- **flagged shapes**: which heuristics fired — `jsx-text`, `jsx-prop`, `obj-key` (column/option definitions), `ternary`, `fallback`, `return`, `ui-call` (toast/setError/…), `call-arg`, `array-item`, `assign`, `concat`; `template/…` means the value was a backtick string.');
console.log('- Run with `--file=<partial-path>` (or any path on disk) to see every flagged literal with line numbers.');
console.log('- `--fail-on-high` exits nonzero when any file renders JSX with no i18n wiring — the CI gate.');
console.log('- `--severity=high` shows only the no-i18n section; `--severity=partial` only the second table; `--json` emits the same data machine-readably.');
console.log('- False positives are possible. Enum-ish values (`{ status: \'Open\' }`), mock/demo data and API constants are the usual ones — the position and prose filters cut most, not all.');
