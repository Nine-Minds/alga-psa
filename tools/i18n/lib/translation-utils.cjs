const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walkJson(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJson(fullPath, base));
    } else if (entry.name.endsWith('.json')) {
      results.push(path.relative(base, fullPath));
    }
  }
  return results.sort();
}

function namespaceFromFile(relativeFile) {
  return relativeFile.replace(/\.json$/, '').split(path.sep).join('/');
}

function collectLeaves(value, prefix = '') {
  const leaves = new Map();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    leaves.set(prefix, value);
    return leaves;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      for (const [leafKey, leafValue] of collectLeaves(child, nextPrefix)) {
        leaves.set(leafKey, leafValue);
      }
    } else {
      leaves.set(nextPrefix, child);
    }
  }
  return leaves;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      addArg(args, arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      addArg(args, key, true);
      continue;
    }
    addArg(args, key, next);
    i++;
  }
  return args;
}

function addArg(args, key, value) {
  if (Object.prototype.hasOwnProperty.call(args, key)) {
    if (!Array.isArray(args[key])) args[key] = [args[key]];
    args[key].push(value);
  } else {
    args[key] = value;
  }
}

function listArg(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadReviewState(filePath, locale = 'pt') {
  if (!fs.existsSync(filePath)) {
    return { version: 1, locale, reviewed: {} };
  }
  return readJson(filePath);
}

function isReviewed(reviewState, namespace, key) {
  const entry = reviewState.reviewed?.[namespace]?.[key];
  if (entry === true) return true;
  return Boolean(entry && typeof entry === 'object' && entry.reviewed === true);
}

function localeTag(glossary, locale) {
  return locale || glossary?.dialect || glossary?.locale || 'en';
}

function allowlistMatchers(glossary, locale) {
  const tag = localeTag(glossary, locale);
  const allowlist = glossary?.identicalAllowlist || {};
  const exact = new Set(allowlist.exact || []);
  const caseInsensitive = new Set(
    (allowlist.caseInsensitive || []).map((value) => String(value).toLocaleLowerCase(tag)),
  );
  const patterns = (allowlist.patterns || []).map((pattern) => new RegExp(pattern, 'u'));

  return {
    isAllowed(value) {
      const str = String(value).trim();
      if (exact.has(str)) return true;
      if (caseInsensitive.has(str.toLocaleLowerCase(tag))) return true;
      return patterns.some((pattern) => pattern.test(str));
    },
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function forbiddenMatchers(glossary, locale) {
  const tag = localeTag(glossary, locale);
  return (glossary?.forbiddenTerms || []).map((entry) => {
    // caseSensitive entries match the original casing: es pronoun "ti" must not
    // match the acronym "TI", which lowercasing would make indistinguishable.
    const escaped = escapeRegExp(entry.caseSensitive ? entry.term : entry.term.toLocaleLowerCase(tag));
    return {
      ...entry,
      locale: tag,
      pattern: new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u'),
      // enWhen scopes a ban to keys whose ENGLISH source matches: the word is
      // only wrong in that sense (nl "cliënt" is fine outside customer copy).
      enPattern: entry.enWhen ? new RegExp(entry.enWhen, 'iu') : null,
      // unless masks value-side spans where the term is legitimate even in a
      // banned context (branded compounds like "Stripe Dashboard").
      unlessPattern: entry.unless ? new RegExp(entry.unless, 'giu') : null,
      // keyUnless exempts specific keys ("namespace:dotted.key") where the string
      // is schema/identifier documentation rather than prose.
      keyPattern: entry.keyUnless ? new RegExp(entry.keyUnless, 'iu') : null,
    };
  });
}

function findForbiddenTerms(value, matchers, locale, enValue, keyPath) {
  const tag = locale || matchers[0]?.locale || 'en';
  // Non-prose spans must not trip forbidden terms (nl "email", fr "status"):
  // {{placeholders}}, `code spans`, URLs, email addresses, dotted identifiers
  // like event names (email.receive) — none are translatable text.
  const rawText = String(value)
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/\b\w+(?:\.\w+)+\b/g, ' ');
  const text = rawText.toLocaleLowerCase(tag);
  return matchers
    .filter((matcher) => {
      if (matcher.enPattern) {
        // Fail open without English context: a scoped ban must never fire globally.
        if (enValue == null || !matcher.enPattern.test(String(enValue))) return false;
      }
      if (matcher.keyPattern && keyPath != null && matcher.keyPattern.test(String(keyPath))) return false;
      const haystack = matcher.caseSensitive ? rawText : text;
      const scoped = matcher.unlessPattern ? haystack.replace(matcher.unlessPattern, ' ') : haystack;
      return matcher.pattern.test(scoped);
    })
    .map((matcher) => ({
      term: matcher.term,
      preferred: matcher.preferred,
      reason: matcher.reason,
    }));
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (!/[",\n\r]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

module.exports = {
  allowlistMatchers,
  collectLeaves,
  csvEscape,
  ensureDir,
  findForbiddenTerms,
  forbiddenMatchers,
  isReviewed,
  listArg,
  loadReviewState,
  markdownEscape,
  namespaceFromFile,
  parseArgs,
  readJson,
  walkJson,
};
