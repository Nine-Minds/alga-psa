// Migration lint rules engine (CM L0g, alga-2026-0002848).
//
// Two layers:
//   (a) JS structure through the TypeScript compiler API: call expressions,
//       `const` initialisers, literal-only `for...of` loops, `exports.config`.
//   (b) A dollar-quote-aware SQL scanner/splitter over every `knex.raw(...)`
//       whose text resolves to literals.
//
// Rules 1-8 are defined in RULES below (source: H-guides-deploy.md section 5,
// refined by docs/plans/2026-10-26-cm-l0g-plan.md section 2). The only
// suppression is an in-file `migration-lint: allow <rule> - <reason>` comment.

import ts from 'typescript';

// ---------------------------------------------------------------------------
// Rule catalogue
// ---------------------------------------------------------------------------

export const RULES = Object.freeze({
  1: 'CREATE INDEX on an existing table needs CONCURRENTLY + IF NOT EXISTS in a `transaction: false` migration',
  2: 'ADD CONSTRAINT CHECK/FOREIGN KEY on an existing table needs NOT VALID, with VALIDATE CONSTRAINT in a different `transaction: false` file',
  3: 'SET NOT NULL / ALTER COLUMN TYPE / DROP / RENAME on an existing table is refused',
  4: 'CREATE TRIGGER on an existing table, or CREATE OR REPLACE FUNCTION on a function main already defines, is refused',
  5: 'INSERT/UPDATE/DELETE on an existing table needs a batching shape (loop + LIMIT)',
  6: 'migration timestamp must be later than the newest on the base branch and unique within the change',
  7: 'DDL must be idempotent (IF NOT EXISTS / hasTable / hasColumn / DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT)',
  8: 'writes to global reference data (permissions, role_permissions, internal_notification_*) are refused',
});

export const REFERENCE_TABLES = [
  /^permissions$/,
  /^role_permissions$/,
  /^internal_notification_categories$/,
  /^internal_notification_subtypes$/,
  /^internal_notification_templates$/,
];
export const REFERENCE_CALLS = ['reconcileAllTenants', 'syncPermissionCatalog'];

const MIN_REASON_CHARS = 12;

// ---------------------------------------------------------------------------
// SQL scanner / splitter
// ---------------------------------------------------------------------------

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Scan SQL once. Returns `masked` (same length as `text`: comments blanked,
 * string-literal and dollar-quoted bodies blanked), the dollar bodies, and the
 * top-level statements. `;` inside strings, comments and `$tag$ ... $tag$`
 * bodies never splits.
 */
export function scanSql(text) {
  const out = [];
  const dollarBodies = [];
  const cuts = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '-' && c2 === '-') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      out.push(blank(text.slice(i, j)));
      i = j;
    } else if (c === '/' && c2 === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; }
        else if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      out.push(blank(text.slice(i, j)));
      i = j;
    } else if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(text[i - 1]) && !/[\w$]/.test(text[i - 2] ?? ' ');
      let j = i + 1;
      while (j < n) {
        if (escapes && text[j] === '\\') { j += 2; continue; }
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      const inner = text.slice(i + 1, j);
      out.push("'" + inner.replace(/[^\n]/g, 'x') + "'");
      i = Math.min(j + 1, n);
    } else if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j++;
      }
      out.push(text.slice(i, Math.min(j + 1, n)));
      i = Math.min(j + 1, n);
    } else if (c === '$' && !/[\w$]/.test(text[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (!m) { out.push(c); i++; continue; }
      const tag = m[0];
      const close = text.indexOf(tag, i + tag.length);
      const bodyEnd = close === -1 ? n : close;
      dollarBodies.push({ start: i + tag.length, end: bodyEnd, tag });
      out.push(tag + blank(text.slice(i + tag.length, bodyEnd)) + (close === -1 ? '' : tag));
      i = close === -1 ? n : close + tag.length;
    } else if (c === ';') {
      cuts.push(i);
      out.push(c);
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  const masked = out.join('');
  const statements = [];
  let from = 0;
  for (const cut of [...cuts, n]) {
    const slice = masked.slice(from, cut);
    const lead = slice.length - slice.trimStart().length;
    if (slice.trim()) {
      statements.push({ start: from + lead, end: cut, masked: slice.trim(), raw: text.slice(from + lead, from + lead + slice.trim().length) });
    }
    from = cut + 1;
  }
  return { masked, dollarBodies, statements };
}

export function splitSqlStatements(text) {
  return scanSql(text).statements.map((s) => s.raw.trim());
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

export function normalizeName(raw) {
  if (!raw) return null;
  const parts = raw.split('.').map((p) => p.trim());
  const last = parts[parts.length - 1];
  return last.startsWith('"') ? last.slice(1, -1).replace(/""/g, '"').toLowerCase() : last.toLowerCase();
}

function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Classify one statement (masked text) into zero or more semantic events.
 * `doGuarded` marks statements found inside a conditional DO block.
 */
export function classifyStatement(maskedStatement) {
  const s = norm(maskedStatement);
  const events = [];
  let m;

  if ((m = new RegExp(String.raw`^CREATE\s+(UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'create-table', table: normalizeName(m[3]), ifNotExists: !!m[2], temp: /TEMP/i.test(m[1] ?? '') });
  } else if ((m = new RegExp(String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'create-index', table: normalizeName(m[4]), concurrently: !!m[2], ifNotExists: !!m[3] });
  } else if ((m = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(${IDENT})[\s\S]*?\sON\s+(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'create-trigger', name: normalizeName(m[1]), table: normalizeName(m[2]) });
  } else if ((m = new RegExp(String.raw`^CREATE\s+(OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'create-function', name: normalizeName(m[2]), orReplace: !!m[1] });
  } else if ((m = new RegExp(String.raw`^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(.+?)(?:\s+(?:CASCADE|RESTRICT))?$`, 'i').exec(s))) {
    for (const t of splitTopLevel(m[2], ',')) events.push({ type: 'drop-table', table: normalizeName(t) });
  } else if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+(.*)$`, 'i').exec(s))) {
    const table = normalizeName(m[1]);
    for (const action of splitTopLevel(m[2], ',')) events.push(...classifyAlterAction(table, action));
  } else if ((m = new RegExp(String.raw`^INSERT\s+INTO\s+(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'dml', verb: 'INSERT', table: normalizeName(m[1]), limit: /\bLIMIT\b/i.test(s) });
  } else if ((m = new RegExp(String.raw`^UPDATE\s+(?:ONLY\s+)?(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'dml', verb: 'UPDATE', table: normalizeName(m[1]), limit: /\bLIMIT\b/i.test(s) });
  } else if ((m = new RegExp(String.raw`^DELETE\s+FROM\s+(?:ONLY\s+)?(${QNAME})`, 'i').exec(s))) {
    events.push({ type: 'dml', verb: 'DELETE', table: normalizeName(m[1]), limit: /\bLIMIT\b/i.test(s) });
  } else if (/^WITH\b/i.test(s)) {
    // CTE-wrapped DML: take every data-modifying target.
    const re = new RegExp(String.raw`(?<!DO\s)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(${QNAME})`, 'gi');
    let mm;
    while ((mm = re.exec(s))) {
      events.push({ type: 'dml', verb: mm[1].split(/\s/)[0].toUpperCase(), table: normalizeName(mm[2]), limit: /\bLIMIT\b/i.test(s) });
    }
  }
  return events;
}

function classifyAlterAction(table, action) {
  const a = norm(action);
  let m;
  if ((m = new RegExp(String.raw`^ADD\s+CONSTRAINT\s+(${IDENT})\s+(CHECK|FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY|EXCLUDE)\b(.*)$`, 'i').exec(a))) {
    const kind = /^CHECK/i.test(m[2]) ? 'check' : /^FOREIGN/i.test(m[2]) ? 'fk' : 'other';
    return [{ type: 'add-constraint', table, name: normalizeName(m[1]), kind, notValid: /\bNOT\s+VALID\s*$/i.test(a) }];
  }
  if ((m = /^ADD\s+(CHECK|FOREIGN\s+KEY)\b(.*)$/i.exec(a))) {
    return [{ type: 'add-constraint', table, name: null, kind: /^CHECK/i.test(m[1]) ? 'check' : 'fk', notValid: /\bNOT\s+VALID\s*$/i.test(a) }];
  }
  if (/^ADD\s+(UNIQUE|PRIMARY|EXCLUDE|CONSTRAINT)\b/i.test(a)) return [];
  if ((m = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, 'i').exec(a))) {
    return [{ type: 'add-column', table, column: normalizeName(m[2]), ifNotExists: !!m[1] }];
  }
  if ((m = new RegExp(String.raw`^VALIDATE\s+CONSTRAINT\s+(${IDENT})`, 'i').exec(a))) {
    return [{ type: 'validate-constraint', table, name: normalizeName(m[1]) }];
  }
  if ((m = new RegExp(String.raw`^DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?(${IDENT})`, 'i').exec(a))) {
    return [{ type: 'drop-constraint', table, name: normalizeName(m[2]), ifExists: !!m[1] }];
  }
  if (/^DROP\s+(?:COLUMN\s+)?(?!CONSTRAINT\b)/i.test(a)) return [{ type: 'drop-column', table }];
  if (/^ALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b/i.test(a)) return [{ type: 'set-not-null', table }];
  if (/^ALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(a)) return [{ type: 'alter-type', table }];
  if (/^RENAME\s+(?:TO|COLUMN)\b/i.test(a) || new RegExp(String.raw`^RENAME\s+${IDENT}\s+TO\b`, 'i').test(a)) {
    return [{ type: 'rename', table }];
  }
  // Citus refuses to rename constraints on distributed tables; drop and re-add under the wanted name instead.
  if ((m = new RegExp(String.raw`^RENAME\s+CONSTRAINT\s+(${IDENT})\s+TO\b`, 'i').exec(a))) {
    return [{ type: 'rename-constraint', table, name: normalizeName(m[1]) }];
  }
  return [];
}

/**
 * Split a SQL text into classified events with offsets into `text`.
 * DO blocks are entered one level so guarded DDL inside them is still seen;
 * function bodies are never re-entered.
 */
export function classifySql(text) {
  const { statements, dollarBodies } = scanSql(text);
  const found = [];
  for (const st of statements) {
    if (/^DO\b/i.test(st.masked)) {
      const body = dollarBodies.find((b) => b.start >= st.start && b.end <= st.end);
      if (!body) continue;
      const bodyText = text.slice(body.start, body.end);
      const guarded = /\bIF\b|\bEXCEPTION\b/i.test(bodyText.replace(/--.*$/gm, ''));
      const inner = scanSql(bodyText);
      for (const ist of inner.statements) {
        const re = /\b(ALTER\s+TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:UNLOGGED\s+)?(?:INDEX|TABLE|TRIGGER|CONSTRAINT\s+TRIGGER|FUNCTION)|DROP\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.exec(ist.masked);
        if (!re) continue;
        const stmt = ist.masked.slice(re.index);
        for (const ev of classifyStatement(stmt)) {
          found.push({ ...ev, offset: body.start + ist.start + re.index, inDo: true, doGuarded: guarded });
        }
      }
      continue;
    }
    for (const ev of classifyStatement(st.masked)) found.push({ ...ev, offset: st.start });
  }
  return found;
}

// ---------------------------------------------------------------------------
// JS analysis
// ---------------------------------------------------------------------------

const KNEX_IDS = new Set(['knex', 'trx', 'tx', 'db', 'transaction', 'conn', 'connection', 'k']);
const SCHEMA_METHODS = new Set(['createTable', 'createTableIfNotExists', 'alterTable', 'table']);
const COLUMN_METHODS = new Set([
  'increments', 'bigIncrements', 'integer', 'bigInteger', 'tinyint', 'smallint', 'text', 'string', 'float', 'double',
  'decimal', 'boolean', 'date', 'dateTime', 'time', 'timestamp', 'timestamps', 'binary', 'enu', 'enum', 'json', 'jsonb',
  'uuid', 'specificType',
]);
const DML_METHODS = { insert: 'INSERT', update: 'UPDATE', del: 'DELETE', delete: 'DELETE', increment: 'UPDATE', decrement: 'UPDATE' };

const UNK = Symbol('unknown-value');
const FN_VALUE = Symbol('function-value'); // an expanded helper parameter bound to a function argument
// Chained query-builder modifiers that leave the SQL argument of `.raw(sql)` untouched.
const EXEC_MODIFIERS = new Set(['connection', 'transacting', 'timeout', 'debug', 'queryContext', 'options', 'on']);
const stripExpr = (n) => {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  return n;
};

const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
const isLoop = (n) => ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);

function fnName(n) {
  if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  const p = n.parent;
  if (!p) return null;
  if (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) return p.name.getText();
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return p.left.getText().split('.').pop();
  return null;
}

/** Analyse one migration source into events + file facts. */
export function analyzeMigration(source, fileName = 'migration.cjs') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const result = { fileName, events: [], transactionFalse: false, parseError: null };
  const diags = sf.parseDiagnostics ?? [];
  if (diags.length) {
    result.parseError = ts.flattenDiagnosticMessageText(diags[0].messageText, '\n');
    return result;
  }

  const guards = []; // { kind: 'table'|'column'|'constraint'|'index', seq, top }
  const skip = new Set();
  let seq = 0;
  const helpers = new Map(); // top-level helper fn node -> name
  const expanded = new Set();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && !['up', 'down'].includes(st.name.text)) helpers.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && !['up', 'down'].includes(d.name.text)) helpers.set(d.name.text, d.initializer);
      }
    }
  }
  const helperNodes = new Set(helpers.values());

  const topFnOf = (node) => {
    let top = null;
    for (let p = node.parent; p; p = p.parent) if (isFn(p)) top = p;
    return top;
  };

  function lookupConst(node, name) {
    for (let p = node.parent; p; p = p.parent) {
      const stmts = ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) ? p.statements : null;
      if (stmts) {
        for (const st of stmts) {
          if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer;
          }
        }
      }
    }
    return null;
  }

  // -> pieces [{ text, node }] or null
  const LIMIT_RE = /\.limit\(|\blimit\s*(\?|\d|\$)/i;
  const PH = '\u0001'; // opaque placeholder for an unresolvable substitution
  function resolvePieces(node, env, depth = 0, opaque = false) {
    const r = resolveStrict(node, env, depth, opaque);
    return r ?? (opaque ? [{ text: PH, node }] : null);
  }
  function resolveStrict(node, env, depth, opaque) {
    if (depth > 8) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: node.text, node }];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return resolvePieces(node.expression, env, depth + 1);
    if (ts.isTemplateExpression(node)) {
      const pieces = [{ text: node.head.text, node: node.head }];
      for (const span of node.templateSpans) {
        const inner = resolvePieces(span.expression, env, depth + 1, true);
        pieces.push(...inner.map((p) => ({ ...p, node: span.expression })), { text: span.literal.text, node: span.literal });
      }
      return pieces;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = resolvePieces(node.left, env, depth + 1, true);
      const r = resolvePieces(node.right, env, depth + 1, true);
      return [...l, ...r];
    }
    if (ts.isIdentifier(node)) {
      if (env.has(node.text)) return typeof env.get(node.text) === 'string' ? [{ text: env.get(node.text), node }] : null;
      const init = lookupConst(node, node.text);
      return init ? resolvePieces(init, env, depth + 1) : null;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'trim' && node.arguments.length === 0) {
      return resolvePieces(node.expression.expression, env, depth + 1);
    }
    return null;
  }

  function resolveStringArray(node, env, depth = 0) {
    if (depth > 6) return null;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return resolveStringArray(node.expression, env, depth + 1);
    if (ts.isArrayLiteralExpression(node)) {
      const out = [];
      for (const el of node.elements) {
        const p = resolvePieces(el, env);
        if (!p) return null;
        out.push(p.map((x) => x.text).join(''));
      }
      return out;
    }
    if (ts.isIdentifier(node)) {
      if (env.has(node.text)) return Array.isArray(env.get(node.text)) ? env.get(node.text) : null;
      const init = lookupConst(node, node.text);
      return init ? resolveStringArray(init, env, depth + 1) : null;
    }
    return null;
  }

  function ctxFor(node, ctx) {
    const top = ctx.root ?? topFnOf(node);
    return {
      inLoop: ctx.loops > 0,
      topId: top ? top.pos : -1,
      limitCtx: [top, topFnOf(node)].some((fn) => fn && LIMIT_RE.test(fn.getText())),
      seq: seq++,
    };
  }
  function addGuard(kind, node, ctx) {
    const top = ctx.root ?? topFnOf(node);
    guards.push({ kind, seq: seq++, top: top ? top.pos : -1 });
  }

  function push(ev, node, ctx, extra = {}) {
    const line = extra.line ?? lineOf(node.getStart());
    result.events.push({ ...ev, anchorLine: lineOf(node.getStart()), callLines: ctx.callLines ?? [], ...ctxFor(node, ctx), ...extra, line });
  }

  function lineAt(pieces, offset) {
    let acc = 0;
    for (const p of pieces) {
      if (offset < acc + p.text.length || p === pieces[pieces.length - 1]) {
        const base = lineOf(p.node.getStart());
        const nl = (p.text.slice(0, Math.max(0, offset - acc)).match(/\n/g) ?? []).length;
        return base + nl;
      }
      acc += p.text.length;
    }
    return 1;
  }

  // Structural = an opaque substitution inside the leading tokens that decide how
  // a tracked statement classifies (verb, table, action keyword, constraint/column
  // name). Substitutions in parentheses, string literals, function bodies, trailing
  // clauses or untracked statements (SELECT, DROP POLICY, GRANT, ...) are opaque-safe.
  const TRACKED_START = /^(ALTER\s+TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+|UNLOGGED\s+|TEMP(?:ORARY)?\s+|CONSTRAINT\s+)?(?:TABLE|INDEX|TRIGGER|FUNCTION)|DROP\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH|DO)\b/i;
  const placeholderInLeadingTokens = (stmt, limit) => {
    // collapse top-level parenthesised groups, then look at the first `limit` tokens
    let depth = 0;
    let flat = '';
    for (const ch of stmt) {
      if (ch === '(') { if (depth === 0) flat += '()'; depth++; }
      else if (ch === ')') depth--;
      else if (depth === 0) flat += ch;
    }
    return flat.trim().split(/\s+/).slice(0, limit).some((t) => t.includes(PH));
  };
  function hasStructuralPlaceholder(text) {
    const { statements, dollarBodies } = scanSql(text);
    for (const st of statements) {
      if (/^DO\b/i.test(st.masked)) {
        const body = dollarBodies.find((b) => b.start >= st.start && b.end <= st.end);
        if (body && hasStructuralPlaceholder(text.slice(body.start, body.end))) return true;
        continue;
      }
      const lead = st.masked.replace(/^[\s\S]*?(?=\b(?:ALTER\s+TABLE|CREATE\b|DROP\s+TABLE|INSERT\s+INTO|UPDATE\b|DELETE\s+FROM)\b)/i, (m) => (/\bTHEN\b|^\s*$/i.test(m) || /^\s*(IF|BEGIN|ELSE)/i.test(m) ? '' : m));
      if (!TRACKED_START.test(lead.trim()) && !lead.trim().startsWith(PH)) continue;
      if (/^ALTER\s+TABLE/i.test(lead.trim())) {
        const parts = splitTopLevel(lead.trim(), ',');
        if (parts.some((p, i) => placeholderInLeadingTokens(p, i === 0 ? 9 : 6))) return true;
      } else if (placeholderInLeadingTokens(lead.trim(), 9)) return true;
    }
    return false;
  }

  function handleRaw(call, ctx) {
    const arg = call.arguments[0];
    if (!arg) return;
    const pieces = resolvePieces(arg, ctx.env);
    if (!pieces) {
      push({ type: 'unresolved', what: 'knex.raw() argument is not a literal-only string' }, call, ctx);
      return;
    }
    let text = pieces.map((p) => p.text).join('');
    // `??` identifier bindings: substitute resolvable literals; `?` only advances the cursor.
    const delta = []; // { at (post offset), shift }
    if (/\?/.test(scanSql(text).masked)) {
      const bindingsArg = call.arguments[1];
      const bindings = bindingsArg && ts.isArrayLiteralExpression(bindingsArg) ? bindingsArg.elements : null;
      const masked = scanSql(text).masked;
      let out = '';
      let last = 0;
      let idx = 0;
      for (let i = 0; i < masked.length; i++) {
        if (masked[i] !== '?') continue;
        const ident = masked[i + 1] === '?';
        const el = bindings ? bindings[idx] : undefined;
        idx++;
        if (ident) {
          const r = el ? resolvePieces(el, ctx.env) : null;
          const val = r ? r.map((x) => x.text).join('') : PH;
          out += text.slice(last, i) + val;
          delta.push({ at: out.length, shift: 2 - val.length });
          last = i + 2;
          i++;
        }
      }
      text = out + text.slice(last);
    }
    const toPre = (off) => off + delta.filter((d) => d.at <= off).reduce((a, d) => a + d.shift, 0);
    if (hasStructuralPlaceholder(text)) {
      push({ type: 'unresolved', what: 'knex.raw() text has a substitution the lint cannot resolve to a literal in a structural position' }, call, ctx);
      return;
    }
    if (/pg_constraint|table_constraints/i.test(text) && /^\s*(SELECT|WITH)\b/i.test(text)) addGuard('constraint', call, ctx);
    if (/pg_indexes|pg_class/i.test(text) && /^\s*(SELECT|WITH)\b/i.test(text)) addGuard('index', call, ctx);
    if (/information_schema\.columns|pg_attribute/i.test(text) && /^\s*(SELECT|WITH)\b/i.test(text)) addGuard('column', call, ctx);
    for (const ev of classifySql(text)) {
      push(ev, call, ctx, { line: lineAt(pieces, toPre(ev.offset)), fromSql: true });
    }
  }

  function chainOf(call) {
    const methods = [];
    const props = [];
    let cur = call;
    for (;;) {
      if (ts.isCallExpression(cur)) {
        const e = cur.expression;
        if (ts.isPropertyAccessExpression(e)) { methods.unshift({ name: e.name.text, call: cur }); cur = e.expression; continue; }
        if (ts.isIdentifier(e)) return { rootCall: cur, rootId: e.text, methods, props };
        return { methods, props };
      }
      if (ts.isPropertyAccessExpression(cur)) { props.unshift(cur.name.text); cur = cur.expression; continue; }
      if (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isIdentifier(cur)) return { rootId: cur.text, methods, props };
      return { methods, props };
    }
  }

  function handleChain(call, ctx) {
    const chain = chainOf(call);
    const names = chain.methods.map((m) => m.name);

    // Guards.
    for (const m of chain.methods) {
      if (m.name === 'hasTable' || m.name === 'hasColumn') {
        addGuard(m.name === 'hasTable' ? 'table' : 'column', m.call, ctx);
      }
    }
    // Reference-data sync helpers.
    {
      const e = call.expression;
      const callee = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (callee && REFERENCE_CALLS.includes(callee)) push({ type: 'reference-call', name: callee }, call, ctx);
    }

    // Builder-in-alter/create callback: root identifier is the callback param.
    if (ctx.builder && chain.rootId === ctx.builder.param && !chain.rootCall && chain.methods.length) {
      if (ctx.builder.mode !== 'alter') return;
      const t = ctx.builder.table;
      const first = names[0];
      if (names.includes('alter')) push({ type: 'alter-type', table: t, builder: true }, call, ctx);
      else if (COLUMN_METHODS.has(first)) push({ type: 'add-column', table: t, ifNotExists: false, builder: true }, call, ctx);
      if (names.includes('references') || names.includes('inTable')) {
        push({ type: 'add-constraint', table: t, name: null, kind: 'fk', notValid: false, builder: true }, call, ctx);
      }
      if (['dropColumn', 'dropColumns'].includes(first)) push({ type: 'drop-column', table: t, builder: true }, call, ctx);
      if (first === 'renameColumn') push({ type: 'rename', table: t, builder: true }, call, ctx);
      if (['index', 'unique'].includes(first)) push({ type: 'create-index', table: t, concurrently: false, ifNotExists: false, builder: true }, call, ctx);
      if (first === 'foreign') push({ type: 'add-constraint', table: t, name: null, kind: 'fk', notValid: false, builder: true }, call, ctx);
      return;
    }

    // knex.schema.*
    if (chain.props.includes('schema') && KNEX_IDS.has(chain.rootId ?? '')) {
      for (const m of chain.methods) {
        const args = m.call.arguments;
        const tbl = () => {
          const p = args[0] ? resolvePieces(args[0], ctx.env) : null;
          return p ? p.map((x) => x.text).join('') : null;
        };
        if (SCHEMA_METHODS.has(m.name)) {
          const table = tbl();
          if (table == null) { push({ type: 'unresolved', what: `schema.${m.name}() table name is not literal` }, m.call, ctx); continue; }
          const cb = args.find((a) => isFn(a));
          if (m.name === 'alterTable' || m.name === 'table') {
            if (cb) { skip.add(cb); visitFn(cb, { ...ctx, builder: { table: table.toLowerCase(), param: cb.parameters[0]?.name.getText(), mode: 'alter' } }); }
          } else {
            push({ type: 'create-table', table: table.toLowerCase(), ifNotExists: m.name === 'createTableIfNotExists', temp: false, builder: true }, m.call, ctx);
            if (cb) { skip.add(cb); visitFn(cb, { ...ctx, builder: { table: table.toLowerCase(), param: cb.parameters[0]?.name.getText(), mode: 'create' } }); }
          }
        } else if (m.name === 'dropTable' || m.name === 'dropTableIfExists') {
          const table = tbl();
          if (table == null) push({ type: 'unresolved', what: `schema.${m.name}() table name is not literal` }, m.call, ctx);
          else push({ type: 'drop-table', table: table.toLowerCase(), builder: true }, m.call, ctx);
        } else if (m.name === 'renameTable') {
          const table = tbl();
          if (table != null) {
            push({ type: 'rename', table: table.toLowerCase(), builder: true }, m.call, ctx);
            const to = args[1] ? resolvePieces(args[1], ctx.env) : null;
            if (to) push({ type: 'create-table', table: to.map((x) => x.text).join('').toLowerCase(), ifNotExists: true, temp: false, builder: true, renamed: true }, m.call, ctx);
          }
        }
      }
      return;
    }

    // knex('table').insert(...) style DML.
    const dml = chain.methods.find((m) => DML_METHODS[m.name]);
    if (dml) {
      let tableArg = null;
      if (chain.rootCall && KNEX_IDS.has(chain.rootId)) tableArg = chain.rootCall.arguments[0];
      else if (!chain.rootCall && KNEX_IDS.has(chain.rootId ?? '') && ['table', 'into', 'from'].includes(names[0])) tableArg = chain.methods[0].call.arguments[0];
      else return;
      const p = tableArg ? resolvePieces(tableArg, ctx.env) : null;
      if (!p) { push({ type: 'unresolved', what: 'knex(<table>) table name is not literal' }, call, ctx); return; }
      const table = p.map((x) => x.text).join('').split(/\s+as\s+/i)[0].split('.').pop().toLowerCase();
      push({ type: 'dml', verb: DML_METHODS[dml.name], table, limit: names.includes('limit'), builder: true }, call, ctx);
    }
  }

  function visitFn(node, ctx) {
    const name = fnName(node);
    if (name === 'down') return; // down() never runs in prod
    const inner = ctx.root ? ctx : { ...ctx, root: node };
    ts.forEachChild(node, (c) => visit(c, inner));
  }

  // Inline-expand a call to a top-level helper with the literal arguments it is called with.
  function expandHelper(call, ctx) {
    const e = call.expression;
    if (!ts.isIdentifier(e) || !helpers.has(e.text)) return false;
    const fn = helpers.get(e.text);
    const stack = ctx.stack ?? [];
    if (stack.includes(fn) || stack.length >= 4) return false;
    const env = new Map();
    fn.parameters.forEach((param, i) => {
      const a = call.arguments[i];
      if (!a || !ts.isIdentifier(param.name)) return;
      const str = resolvePieces(a, ctx.env);
      if (str) { env.set(param.name.text, str.map((x) => x.text).join('')); return; }
      const arr = resolveStringArray(a, ctx.env);
      if (arr) { env.set(param.name.text, arr); return; }
      const fv = evalVal(a);
      if (fv.size && ![...fv].includes(UNK)) env.set(param.name.text, FN_VALUE);
    });
    expanded.add(fn);
    // Findings inside the body can be annotated at this call site (innermost call first), so one
    // reviewed call is allowed without blanket-allowing everything else routed through the helper.
    const callLines = [lineOf(call.getStart()), ...(ctx.callLines ?? [])];
    const inner = { ...ctx, env, stack: [...stack, fn], builder: undefined, callLines };
    ts.forEachChild(fn, (c) => visit(c, inner));
    return true;
  }

  function visit(node, ctx) {
    if (isFn(node)) {
      if (skip.has(node) || helperNodes.has(node)) return;
      visitFn(node, ctx);
      return;
    }
    if (ts.isConditionalExpression(node) || ts.isIfStatement(node)) {
      const taken = typeofGuard(ts.isIfStatement(node) ? node.expression : node.condition, ctx.env);
      if (taken !== null) {
        const branch = ts.isIfStatement(node)
          ? (taken ? node.thenStatement : node.elseStatement)
          : (taken ? node.whenTrue : node.whenFalse);
        if (branch) visit(branch, ctx);
        return;
      }
    }
    if (ts.isForOfStatement(node)) {
      const decl = node.initializer;
      const arr = resolveStringArray(node.expression, ctx.env);
      if (arr && ts.isVariableDeclarationList(decl) && decl.declarations.length === 1 && ts.isIdentifier(decl.declarations[0].name)) {
        const id = decl.declarations[0].name.text;
        for (const v of arr) {
          const env = new Map(ctx.env).set(id, v);
          visit(node.statement, { ...ctx, env, loops: ctx.loops + 1 });
        }
        return;
      }
      ts.forEachChild(node, (c) => visit(c, { ...ctx, loops: ctx.loops + 1 }));
      return;
    }
    if (isLoop(node)) {
      ts.forEachChild(node, (c) => visit(c, { ...ctx, loops: ctx.loops + 1 }));
      return;
    }
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const isMember = ts.isPropertyAccessExpression(e);
      // arr.forEach(cb) / arr.map(cb) over a literal array
      if (isMember && ['forEach', 'map'].includes(e.name.text) && node.arguments[0] && isFn(node.arguments[0])) {
        const arr = resolveStringArray(e.expression, ctx.env);
        const cb = node.arguments[0];
        const param = cb.parameters[0]?.name;
        if (arr && param && ts.isIdentifier(param)) {
          skip.add(cb);
          for (const v of arr) {
            const env = new Map(ctx.env).set(param.text, v);
            ts.forEachChild(cb, (c) => visit(c, { ...ctx, env, loops: ctx.loops + 1 }));
          }
          return;
        }
      }
      if (isMember && e.name.text === 'raw' && !executorSinks.has(node)) handleRaw(node, ctx);
      else if (!isMember) handleExecutorCall(node, ctx);
      expandHelper(node, ctx);
      const outermost = !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node);
      if (outermost) handleChain(node, ctx);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText();
      if (/(^|\.)exports\.config$/.test(left) || left === 'exports.config') readConfig(node.right);
    } else if (ts.isPropertyAssignment(node) && node.name.getText() === 'config' && ts.isBinaryExpression(node.parent?.parent ?? node)) {
      // module.exports = { config: ... } handled below
    }
    if (ts.isObjectLiteralExpression(node) && ts.isBinaryExpression(node.parent) && node.parent.left.getText() === 'module.exports') {
      const cfg = node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'config');
      if (cfg) readConfig(cfg.initializer);
    }
    ts.forEachChild(node, (c) => {
      if (skip.has(c)) return;
      visit(c, ctx);
    });
  }

  function readConfig(obj) {
    if (!ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'transaction' && p.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        result.transactionFalse = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // In-file executor wrappers.
  //
  // An executor is a closure that forwards its first parameter as the SQL of a
  // raw sink: `(sql, b) => knex.raw(sql, b ?? []).connection(c)`. A call to it
  // is a raw-SQL call whose SQL is argument 0. Because migrations hand the
  // closure to callbacks and helpers (`work(run)`), a small whole-file value
  // flow binds each function-valued parameter to the set of functions that can
  // reach it from the call sites in this file. The result is trusted only when
  // that set is complete: any call site that passes something else (or nothing,
  // or a spread), any call through a callee that is not statically known, and
  // any function that leaves the file's call graph (exported, stored, returned,
  // given to a foreign function) contributes UNK and makes the binding
  // undecided.
  // LEVERAGE: friction lint-resolver-binding - the AST walk resolves values through a per-expansion env and lookupConst; this whole-file call-site binding is a second, separate resolution path that only the executor check consults. A single scope-aware value resolver should replace both.
  // -------------------------------------------------------------------------
  const executorSinks = new Set(); // raw() calls that are the body of an executor closure
  const paramVals = new Map(); // ParameterDeclaration -> Set<fn node | UNK>
  const escaped = new Map(); // fn node -> node where it left the modelled call graph
  const getParam = (p) => {
    if (!paramVals.has(p)) paramVals.set(p, new Set());
    return paramVals.get(p);
  };

  const patternBinds = (name, name0) => {
    if (ts.isIdentifier(name)) return name.text === name0;
    return name.elements.some((el) => !ts.isOmittedExpression(el) && patternBinds(el.name, name0));
  };
  const UNMODELLED = Symbol('unmodelled-binding');
  function declOf(id) {
    const name = id.text;
    for (let p = id.parent; p; p = p.parent) {
      if (isFn(p)) {
        for (const prm of p.parameters) {
          if (ts.isIdentifier(prm.name) && prm.name.text === name) return prm;
          if (!ts.isIdentifier(prm.name) && patternBinds(prm.name, name)) return UNMODELLED;
        }
        if (!ts.isArrowFunction(p) && !ts.isMethodDeclaration(p) && p.name?.text === name && ts.isFunctionExpression(p)) return UNMODELLED;
      }
      if (ts.isCatchClause(p) && p.variableDeclaration && patternBinds(p.variableDeclaration.name, name)) return UNMODELLED;
      if ((ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer && ts.isVariableDeclarationList(p.initializer)
        && p.initializer.declarations.some((d) => patternBinds(d.name, name))) return UNMODELLED;
      if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
        for (const st of p.statements) {
          if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
          if (ts.isClassDeclaration(st) && st.name?.text === name) return UNMODELLED;
          if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
              if (ts.isIdentifier(d.name) && d.name.text === name) return d;
              if (!ts.isIdentifier(d.name) && patternBinds(d.name, name)) return UNMODELLED;
            }
          }
        }
      }
    }
    return null;
  }

  function evalVal(expr, depth = 0) {
    const e = stripExpr(expr);
    if (depth > 10) return new Set([UNK]);
    if (isFn(e) && !ts.isMethodDeclaration(e)) return new Set([e]);
    if (ts.isIdentifier(e)) {
      const d = declOf(e);
      if (d && d !== UNMODELLED) {
        if (ts.isFunctionDeclaration(d)) return new Set([d]);
        if (ts.isParameter(d)) return new Set(getParam(d));
        if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer && (d.parent.flags & ts.NodeFlags.Const)) return evalVal(d.initializer, depth + 1);
      }
    }
    return new Set([UNK]);
  }

  const execMemo = new Map();
  function executorSink(fn) {
    if (fn === UNK) return null;
    if (execMemo.has(fn)) return execMemo.get(fn);
    let found = null;
    const p0 = fn.parameters?.[0];
    if (p0 && ts.isIdentifier(p0.name) && !p0.dotDotDotToken && fn.body) {
      let expr = null;
      if (ts.isBlock(fn.body)) {
        const only = fn.body.statements.length === 1 ? fn.body.statements[0] : null;
        if (only && ts.isReturnStatement(only) && only.expression) expr = only.expression;
      } else expr = fn.body;
      while (expr) {
        expr = stripExpr(expr);
        if (ts.isAwaitExpression(expr)) { expr = expr.expression; continue; }
        if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) break;
        const name = expr.expression.name.text;
        if (name === 'raw') {
          const a = expr.arguments[0];
          if (a && ts.isIdentifier(a) && a.text === p0.name.text && declOf(a) === p0) found = expr;
          break;
        }
        if (!EXEC_MODIFIERS.has(name)) break;
        expr = expr.expression.expression;
      }
    }
    execMemo.set(fn, found);
    return found;
  }

  const allCalls = [];
  const occurrences = []; // identifiers / inline functions that may carry a function value
  (function collect(n) {
    if (ts.isCallExpression(n)) allCalls.push(n);
    if (isFn(n) && !ts.isMethodDeclaration(n)) occurrences.push(n);
    else if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n)
        || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isPropertyAssignment(p) || ts.isBindingElement(p) || ts.isMethodDeclaration(p)) && p.name === n);
      if (!isName) occurrences.push(n);
    }
    ts.forEachChild(n, collect);
  })(sf);

  const grow = (set, items) => {
    let changed = false;
    for (const x of items) if (!set.has(x)) { set.add(x); changed = true; }
    return changed;
  };
  let flowOk = true;
  for (let iter = 0, changed = true; changed; iter++) {
    if (iter > 50) { flowOk = false; break; }
    changed = false;
    for (const call of allCalls) {
      const callees = evalVal(call.expression);
      if (callees.has(UNK)) continue; // arguments are treated as escaping below
      for (const g of callees) {
        g.parameters.forEach((prm, i) => {
          const set = getParam(prm);
          if (!ts.isIdentifier(prm.name) || prm.dotDotDotToken) { changed = grow(set, [UNK]) || changed; return; }
          const arg = call.arguments[i];
          if (!arg || call.arguments.slice(0, i + 1).some((a) => ts.isSpreadElement(a))) { changed = grow(set, [UNK]) || changed; return; }
          changed = grow(set, evalVal(arg)) || changed;
        });
      }
    }
    for (const occ of occurrences) {
      const vals = [...evalVal(occ)].filter((x) => x !== UNK);
      if (!vals.length) continue;
      let site = occ;
      while (ts.isParenthesizedExpression(site.parent) || ts.isAsExpression(site.parent) || ts.isNonNullExpression(site.parent)) site = site.parent;
      const par = site.parent;
      let ok = false;
      if (ts.isCallExpression(par)) {
        if (par.expression === site) ok = true;
        else if (par.arguments.includes(site)) ok = !evalVal(par.expression).has(UNK);
      } else if (ts.isFunctionDeclaration(par) || ts.isFunctionExpression(par)) ok = true;
      else if (ts.isVariableDeclaration(par) && par.initializer === site && ts.isIdentifier(par.name) && (par.parent.flags & ts.NodeFlags.Const)) ok = true;
      if (!ok) for (const f of vals) if (!escaped.has(f)) { escaped.set(f, site); changed = true; }
    }
  }
  if (!flowOk) for (const f of occurrences) escaped.set(f, f); // could not settle: nothing is trusted

  /** true = `typeof id === 'function'` holds, false = fails, null = not decidable here. */
  function typeofGuard(cond, env) {
    const c = stripExpr(cond);
    if (!ts.isBinaryExpression(c)) return null;
    const op = c.operatorToken.kind;
    const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
    const ne = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
    if (!eq && !ne) return null;
    const [t, lit] = ts.isTypeOfExpression(stripExpr(c.left)) ? [stripExpr(c.left), c.right] : [stripExpr(c.right), c.left];
    if (!ts.isTypeOfExpression(t) || !ts.isStringLiteral(lit) || lit.text !== 'function' || !ts.isIdentifier(stripExpr(t.expression))) return null;
    const id = stripExpr(t.expression).text;
    if (!env.has(id)) return null;
    const isFnVal = env.get(id) === FN_VALUE;
    return eq ? isFnVal : !isFnVal;
  }

  for (const call of allCalls) {
    if (!ts.isPropertyAccessExpression(call.expression)) continue;
    const sinkOwner = [...evalAllExecutors()].find((f) => executorSink(f) === call);
    if (sinkOwner) executorSinks.add(call);
  }
  function evalAllExecutors() {
    return occurrences.filter((o) => isFn(o) && executorSink(o));
  }

  function handleExecutorCall(call, ctx) {
    const vals = evalVal(call.expression);
    const execs = [...vals].filter((f) => f !== UNK && executorSink(f));
    if (!execs.length) return;
    if (execs.length === vals.size) handleRaw(call, ctx);
    else {
      push({ type: 'unresolved', what: 'a SQL-executor closure parameter is not bound to the executor at every call site (or its binding is unknown)' }, call, ctx);
    }
  }


  visit(sf, { env: new Map(), loops: 0 });
  // An executor handed to code the lint cannot follow runs SQL nobody sees.
  for (const [f, site] of escaped) {
    if (executorSink(f)) push({ type: 'unresolved', what: 'a SQL-executor closure is passed to code the lint cannot follow' }, site, { env: new Map(), loops: 0 });
  }
  // Helpers that were never called with resolvable shape are still analysed (arguments unbound).
  for (const fn of helperNodes) {
    if (!expanded.has(fn) && fnName(fn) !== 'down') ts.forEachChild(fn, (c) => visit(c, { env: new Map(), loops: 0, root: fn }));
  }
  result.guards = guards;
  return result;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

const ANNOTATION_RE = /migration-lint:\s*allow\s+(\S+?)\s*(?:[-–—]+\s*(.*?))?\s*(?:\*\/)?\s*$/;

export function parseAnnotations(source) {
  const lines = source.split('\n');
  const out = [];
  lines.forEach((text, idx) => {
    const m = ANNOTATION_RE.exec(text);
    if (!m || !/(\/\/|--|\/\*|\*)/.test(text.slice(0, m.index))) return;
    const rawRule = m[1].replace(/^R/i, '');
    const rule = /^(\*-)?UNRESOLVED$/i.test(rawRule) ? 'UNRESOLVED' : rawRule;
    const reason = (m[2] ?? '').trim();
    const problems = [];
    if (!/^([1-8]|UNRESOLVED)$/.test(rule)) problems.push(rule.toLowerCase() === 'all' ? '`allow all` is not accepted' : `unknown rule id "${m[1]}"`);
    if (reason.replace(/\s/g, '').length < MIN_REASON_CHARS) problems.push(`reason must be at least ${MIN_REASON_CHARS} non-space characters`);
    out.push({ line: idx + 1, rule, reason, problems });
  });
  return out;
}

function annotationFor(annotations, violation) {
  const byLine = new Map();
  for (const a of annotations) {
    if (!byLine.has(a.line)) byLine.set(a.line, []);
    byLine.get(a.line).push(a);
  }
  const candidates = [...new Set([violation.line, violation.anchorLine ?? violation.line, ...(violation.callLines ?? [])])];
  for (const start of candidates) {
    // The offending line, then the contiguous annotation block directly above it.
    let l = start;
    const own = (byLine.get(l) ?? []).find((a) => a.rule === String(violation.rule) && !a.problems.length);
    if (own) return own;
    for (l = start - 1; byLine.has(l); l--) {
      const hit = byLine.get(l).find((a) => a.rule === String(violation.rule) && !a.problems.length);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

export function timestampOf(fileName) {
  const base = fileName.split('/').pop();
  const m = /^(\d{8,14})_/.exec(base);
  return m ? m[1].padEnd(14, '0') : null;
}

const isReferenceTable = (t) => REFERENCE_TABLES.some((re) => re.test(t));
const isSystemTable = (t) => /^(pg_|information_schema|knex_migrations)/.test(t);

/**
 * Lint a set of migration files as one change set.
 *
 * files: [{ name, source }]
 * ctx:   { isExistingTable(table, ts), isExistingFunction(name, ts),
 *          baseMaxTimestamp?: string }   (rule 6 is skipped without it)
 *
 * A file may carry `ctx` (its own table/function view, e.g. as-of its own
 * timestamp for a modified migration) and `skipBaseMax` (exempt from the
 * "not later than base" half of rule 6; the duplicate check still applies,
 * except between two files that both carry `onBase`: a duplicate inherited
 * from base is not introduced by this change).
 */
export function lintMigrationSet(files, ctx) {
  const analyses = files.map((f) => ({ ...f, a: analyzeMigration(f.source, f.name), ts: timestampOf(f.name), annotations: parseAnnotations(f.source) }));
  const raw = [];
  const undecided = [];

  // Cross-file lookup for rule 2: VALIDATE CONSTRAINT <name> per file.
  const validates = [];
  for (const f of analyses) {
    for (const ev of f.a.events) if (ev.type === 'validate-constraint') validates.push({ file: f, ev });
  }

  const seenTs = new Map();
  for (const f of analyses) {
    const add = (rule, ev, message) => raw.push({ file: f.name, line: ev.line, anchorLine: ev.anchorLine, callLines: ev.callLines, rule, message, table: ev.table });

    if (f.a.parseError) {
      undecided.push({ file: f.name, line: 1, rule: 'PARSE', message: `cannot parse: ${f.a.parseError}` });
      continue;
    }
    const existing = (t) => !!t && !isSystemTable(t) && (f.ctx ?? ctx).isExistingTable(t, f.ts);
    const events = f.a.events;
    const guardedBefore = (kind, ev) => ev.doGuarded || f.a.guards.some((g) => g.kind === kind && g.top === ev.topId && g.seq < ev.seq);
    const createdEarlier = (ev) => events.some((e) => e.type === 'create-table' && e.table === ev.table && e.seq < ev.seq && (e.ifNotExists || guardedBefore('table', e)));

    // Rule 6 (file-level).
    if (ctx.baseMaxTimestamp !== undefined) {
      const at = { line: 1, anchorLine: 1 };
      if (!f.ts) add(6, at, 'filename has no numeric timestamp prefix');
      else {
        if (!f.skipBaseMax && f.ts <= ctx.baseMaxTimestamp.padEnd(14, '0')) add(6, at, `timestamp ${f.ts} is not later than the newest on base (${ctx.baseMaxTimestamp})`);
        const other = seenTs.get(f.ts);
        // A collision between two files that were both already on base is inherited, not introduced by this change.
        if (other && other.name !== f.name && !(f.onBase && other.onBase)) add(6, at, `duplicate timestamp ${f.ts} (also ${other.name})`);
        seenTs.set(f.ts, f);
      }
    }

    const addedConstraints = new Set(events.filter((e) => e.type === 'add-constraint' && e.name).map((e) => `${e.table}.${e.name}`));
    const dropsIfExistsBefore = (ev) => events.some((e) => e.type === 'drop-constraint' && e.ifExists && e.table === ev.table && e.name === ev.name && e.seq < ev.seq);

    for (const ev of events) {
      switch (ev.type) {
        case 'unresolved':
          undecided.push({ file: f.name, line: ev.line, anchorLine: ev.anchorLine, callLines: ev.callLines, rule: 'UNRESOLVED', message: ev.what });
          break;

        case 'create-index': {
          if (existing(ev.table)) {
            const miss = [];
            if (ev.builder) miss.push('the knex builder cannot create the index CONCURRENTLY; use knex.raw');
            else {
              if (!ev.concurrently) miss.push('missing CONCURRENTLY');
              if (!ev.ifNotExists) miss.push('missing IF NOT EXISTS');
              if (!f.a.transactionFalse) miss.push('file must set exports.config = { transaction: false }');
            }
            if (miss.length) add(1, ev, `CREATE INDEX on existing table "${ev.table}": ${miss.join('; ')}`);
          } else if (!ev.ifNotExists && !ev.builder && !guardedBefore('table', ev) && !guardedBefore('index', ev) && !createdEarlier(ev)) {
            add(7, ev, `CREATE INDEX on "${ev.table}" needs IF NOT EXISTS`);
          }
          break;
        }

        case 'add-constraint': {
          if (existing(ev.table) && (ev.kind === 'check' || ev.kind === 'fk')) {
            if (ev.builder) add(2, ev, `foreign key via knex builder on existing table "${ev.table}" validates immediately; use ADD CONSTRAINT ... NOT VALID`);
            else if (!ev.name) add(2, ev, `unnamed constraint on existing table "${ev.table}": name it so VALIDATE CONSTRAINT can be matched`);
            else if (!ev.notValid) add(2, ev, `ADD CONSTRAINT ${ev.name} on existing table "${ev.table}" must be NOT VALID`);
            else {
              const matches = validates.filter((v) => v.ev.name === ev.name && v.ev.table === ev.table);
              if (!matches.length) add(2, ev, `NOT VALID constraint ${ev.name} has no VALIDATE CONSTRAINT in any file of this change`);
              else if (matches.every((v) => v.file.name === f.name)) add(2, ev, `VALIDATE CONSTRAINT ${ev.name} must be in a different migration file than its NOT VALID`);
            }
          }
          if (!ev.builder && ev.name && !ev.doGuarded && !dropsIfExistsBefore(ev) && !guardedBefore('constraint', ev) && !(createdEarlier(ev) && !existing(ev.table))) {
            add(7, ev, `ADD CONSTRAINT ${ev.name} needs a preceding DROP CONSTRAINT IF EXISTS ${ev.name} in the same file`);
          }
          break;
        }

        case 'validate-constraint':
          if (existing(ev.table) && !f.a.transactionFalse) add(2, ev, `VALIDATE CONSTRAINT ${ev.name} in a transactional file; set exports.config = { transaction: false }`);
          break;

        case 'drop-table':
          if (existing(ev.table)) add(3, ev, `DROP TABLE "${ev.table}" on an existing table`);
          break;
        case 'drop-column':
          if (existing(ev.table)) add(3, ev, `DROP COLUMN on existing table "${ev.table}"`);
          break;
        case 'rename':
          if (existing(ev.table)) add(3, ev, `RENAME on existing table "${ev.table}"`);
          break;
        case 'rename-constraint':
          if (existing(ev.table)) add(3, ev, `RENAME CONSTRAINT ${ev.name} on existing table "${ev.table}" (unsupported on Citus distributed tables; drop and re-add it under the wanted name)`);
          break;
        case 'set-not-null':
          if (existing(ev.table)) add(3, ev, `SET NOT NULL on existing table "${ev.table}"`);
          break;
        case 'alter-type':
          if (existing(ev.table)) add(3, ev, ev.builder ? `.alter() on existing table "${ev.table}" (type/nullability change)` : `ALTER COLUMN TYPE on existing table "${ev.table}"`);
          break;
        case 'drop-constraint':
          if (existing(ev.table) && !addedConstraints.has(`${ev.table}.${ev.name}`)) add(3, ev, `DROP CONSTRAINT ${ev.name} on existing table "${ev.table}" without re-adding it in the same file`);
          break;

        case 'create-trigger':
          if (existing(ev.table)) add(4, ev, `CREATE TRIGGER ${ev.name} on existing table "${ev.table}" (Citus skips triggers; keep the invariant in app code)`);
          break;
        case 'create-function':
          if (ev.orReplace && (f.ctx ?? ctx).isExistingFunction(ev.name, f.ts)) add(4, ev, `CREATE OR REPLACE FUNCTION ${ev.name} replaces a function main already defines`);
          break;

        case 'create-table':
          if (!ev.ifNotExists && !ev.temp && !ev.renamed && !guardedBefore('table', ev)) add(7, ev, `CREATE TABLE "${ev.table}" needs IF NOT EXISTS or a preceding hasTable guard`);
          break;
        case 'add-column':
          if (!ev.ifNotExists && !guardedBefore('column', ev)) add(7, ev, ev.builder ? `column added on "${ev.table}" through the knex builder needs a preceding hasColumn guard` : `ADD COLUMN on "${ev.table}" needs IF NOT EXISTS`);
          break;

        case 'dml': {
          if (isSystemTable(ev.table)) break;
          if (isReferenceTable(ev.table)) {
            add(8, ev, `${ev.verb} on global reference table "${ev.table}"`);
          } else if (existing(ev.table)) {
            const batched = ev.inLoop && (ev.limit || ev.limitCtx);
            if (!batched) add(5, ev, `${ev.verb} on existing table "${ev.table}" without a batching shape (loop + LIMIT)`);
          }
          break;
        }
        case 'reference-call':
          add(8, ev, `call to ${ev.name}() from a migration writes global reference data for every tenant`);
          break;
        default:
      }
    }
  }

  // Dedupe (loops over literal arrays repeat identical findings).
  const seen = new Set();
  const unique = raw.filter((v) => {
    const k = `${v.file}:${v.line}:${v.rule}:${v.message}:${(v.callLines ?? []).join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const violations = [];
  const allowed = [];
  const used = new Set();
  const byName = new Map(analyses.map((f) => [f.name, f]));
  const allFindings = [...unique, ...undecided.filter((u) => u.rule === 'UNRESOLVED').map((u) => ({ ...u }))];
  const parseFailures = undecided.filter((u) => u.rule === 'PARSE');
  const open = [];
  for (const v of allFindings) {
    const f = byName.get(v.file);
    const hit = annotationFor(f.annotations, v);
    if (hit) {
      used.add(`${v.file}:${hit.line}`);
      allowed.push({ ...v, reason: hit.reason, annotationLine: hit.line });
    } else if (v.rule === 'UNRESOLVED') open.push(v);
    else violations.push(v);
  }
  const invalidAnnotations = [];
  const stale = [];
  for (const f of analyses) {
    for (const a of f.annotations) {
      if (a.problems.length) {
        invalidAnnotations.push({ file: f.name, line: a.line, rule: 'ANNOTATION', message: `invalid annotation: ${a.problems.join('; ')}` });
      } else if (!used.has(`${f.name}:${a.line}`)) {
        stale.push({ file: f.name, line: a.line, rule: a.rule, message: `annotation for rule ${a.rule} matches no finding` });
      }
    }
  }
  violations.push(...invalidAnnotations);
  const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || String(a.rule).localeCompare(String(b.rule));
  // callLines only steers annotation matching (each call path is judged on its own); findings are
  // reported once per offending line, however many call paths reach it.
  const report = (list) => {
    const reported = new Set();
    return list.map(({ callLines, ...v }) => v).filter((v) => {
      const k = `${v.file}:${v.line}:${v.rule}:${v.message}`;
      if (reported.has(k)) return false;
      reported.add(k);
      return true;
    }).sort(order);
  };
  return {
    violations: report(violations),
    allowed: report(allowed),
    stale: stale.sort(order),
    undecided: report([...open, ...parseFailures]),
    filesScanned: files.length,
  };
}

// ---------------------------------------------------------------------------
// Schema facts ("existing table" / "existing function" sets)
// ---------------------------------------------------------------------------

/**
 * Derive what migrations create, from the migration sources alone (no DB).
 * Returns { tables: {name: ts}, functions: {name: ts}, maxTimestamp }.
 * Limitation: tables created by setup/create_database.js or seeds are invisible.
 */
export function deriveSchemaFacts(files) {
  const tables = {};
  const functions = {};
  let maxTimestamp = '';
  for (const f of files) {
    const ts = timestampOf(f.name);
    if (!ts) continue;
    if (ts > maxTimestamp) maxTimestamp = ts;
    const a = analyzeMigration(f.source, f.name);
    for (const ev of a.events) {
      if (ev.type === 'create-table' && !ev.temp && (tables[ev.table] === undefined || ts < tables[ev.table])) tables[ev.table] = ts;
      if (ev.type === 'create-function' && (functions[ev.name] === undefined || ts < functions[ev.name])) functions[ev.name] = ts;
    }
  }
  return { tables, functions, maxTimestamp };
}

/** Build the lint context from facts. `asOf` = per-file temporal view (audit); otherwise "anything in facts exists". */
export function contextFromFacts(facts, { asOf = false, baseMaxTimestamp } = {}) {
  const before = (created, ts) => created !== undefined && (!asOf || (ts && created < ts));
  return {
    isExistingTable: (t, ts) => before(facts.tables[t], ts),
    isExistingFunction: (n, ts) => before(facts.functions[n], ts),
    baseMaxTimestamp,
  };
}

export function formatViolation(v) {
  return `${v.file}:${v.line}: R${v.rule} ${v.message}`;
}
