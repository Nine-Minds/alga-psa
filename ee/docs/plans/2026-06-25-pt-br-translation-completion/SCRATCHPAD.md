# SCRATCHPAD — pt-BR translation completion

Rolling working memory. Append discoveries, decisions, commands, gotchas.

## Decisions (locked 2026-06-25)
1. **Locale code:** keep `pt`; content = Brazilian Portuguese; relabel
   `localeNames.pt = 'Português (Brasil)'`. Do NOT create a `pt-BR` directory —
   i18next is configured `load: 'languageOnly'` (`packages/core/src/lib/i18n/config.ts:103`),
   which strips region codes, so `pt-BR/` would never load and would resolve back to `pt`.
2. **Go-live gating:** `pt` STAYS in `INCOMPLETE_LOCALES`. The loop does NOT un-gate it.
   Produce a native-review export instead. Removing `pt` from `INCOMPLETE_LOCALES` is a
   separate, post-review one-liner.
3. **Existing 36%:** FULL re-audit. Every one of the 22,567 keys is verified for pt-BR
   dialect + product context — not just the missing ~14.5k.

## Current state (measured 2026-06-25)
- UI strings: 8,103 / 22,567 translated = **35.9%**. (Other langs ~95%.)
- ~14,464 keys identical to English (baseline legit-identical in complete langs ≈ 800–1,200).
- Email templates (`system_email_templates`): **0** pt rows. en/fr/es/de/nl full; it/pl partial.
- Internal notif templates (`internal_notification_templates`): **0** pt rows. en/fr/es/de/nl/it/pl present.
- `validate-translations.cjs` already PASSES for pt structurally (all 45 files, all keys, valid
  plurals/interpolation) — the gap is purely *content* (English left in place + register).

### Per-namespace remaining (UI) — biggest first
contracts 1,342 · workflows 1,227 · projects(features) 1,247 · clients 968 · tickets(features) 1,045 ·
assets 798 · common 688 · workflows... (full machine-readable snapshot: scratchpad/pt_stats.json at gen time).
Least-translated (start here for impact): contract-lines 0%, dispatch 0%, surveys 0%,
billing 1%, onboarding 1%, contracts 1%, credits 2%, licensing 3%, quotes 3%, core 6%.
Most-translated (lightest re-audit): auth 100%, account 97%, service-catalog 97%,
features/billing 97%, email-providers 96%, user-activities 95%, chat 94%, integrations 94%.

## Key file paths
- Locale config / supportedLocales / INCOMPLETE_LOCALES / localeNames:
  `packages/core/src/lib/i18n/config.ts`  (INCOMPLETE_LOCALES at ~line 121; localeNames ~line 27; load:'languageOnly' ~line 103)
- UI locale files: `server/public/locales/{en,pt}/**.json` (45 namespaces, nested: common, client-portal/*, features/*, msp/*)
- Validator: `scripts/validate-translations.cjs` (CLDR plural-aware, interpolation, key parity)
- Missing-key scanner: `scripts/find-missing-i18n-keys.cjs`
- CI: `.github/workflows/validate-translations.yml`
- i18n docs: `docs/architecture/i18n.md`; translation guides under `.ai/translation/`

### Email templates (PR 2)
- **Source-of-truth (bakes ALL languages, used by dev seed):**
  `server/migrations/utils/templates/email/{auth,tickets,invoices,projects,appointments,time,surveys,billing,sla}/*.cjs`
  → each exports `getTemplate()` with per-language blocks. Confirmed langs baked: en/fr/es/de/nl/it/pl. **pt absent.**
- Dev seed that consumes them: `server/seeds/dev/68_add_notification_templates.cjs` → `upsertEmailTemplate()`.
- **Production migration reference (Polish):** `server/migrations/20251228123000_add_polish_email_templates.cjs` (1,673 lines).
- Schema: `system_email_templates(name, language_code, subject, html_content, text_content, notification_subtype_id)`,
  UNIQUE `(name, language_code)`. Tenant overrides: `tenant_email_templates`.
- Locale resolver: `packages/notifications/src/notifications/emailLocaleResolver.ts`.
  ⚠️ **Internal users always get English email**; pt email only ever serves client-portal recipients. Still translate all 36 for consistency w/ pl.
- 36 template names: see PRD §4.3 / features `email-pt-*` groups.

### Internal notification templates (PR 2)
- Schema: `internal_notification_templates(name, language_code VARCHAR(2), title, message, subtype_id)`, UNIQUE `(name, language_code)`.
- English seed: `server/migrations/20251031160001_seed_internal_notification_templates.cjs`
- fr/es/de/nl/it seed: `...160002_seed_internal_notification_templates_translations.cjs`
- **Polish reference migration:** `server/migrations/20251228120000_add_polish_internal_notification_templates.cjs` (191 lines).
- Categories/subtypes: tickets, projects, invoices, messages, system (+ client variants, + appointments).
- Resolver: `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts` → `getUserLocale()`.

## pt-BR glossary seed (build this first — `glossary` group)
Domain term → Brazilian PT (NOT the wrong-register form):
- ticket → **chamado** (NOT bilhete/ingresso — those are admission tickets)
- billing → **faturamento** ; invoice → **fatura** ; invoicing → **faturamento**
- asset → **ativo** ; assets → **ativos**
- client → **cliente** ; contact → **contato** (BR spelling, not "contacto")
- schedule → **agenda/agendamento** ; dispatch → **despacho**
- board → **quadro** ; workflow → **fluxo de trabalho** ; settings → **configurações**
- quote → **orçamento** ; credit → **crédito** ; contract → **contrato**
- knowledge base → **base de conhecimento** ; survey → **pesquisa**
- time entry → **lançamento de horas/apontamento** ; user → **usuário**
Forbidden European-PT markers (flag if present in pt files):
- comboio→trem · telemóvel→celular · ecrã→tela · registo→registro · utilizador→usuário ·
  rato→mouse · autocarro→ônibus · ficheiro→arquivo · ção spelling diffs · "casa de banho" etc.
Allowlist (legit identical to en — don't flag): Status, Dashboard, Email, ID, URL, API, SLA,
PDF, CSV, OK, proper nouns, product names, units, numeric codes.

## Mechanism gotchas
- Email pt must be added in **BOTH** the baked source-of-truth files AND a production migration,
  or dev-seed DBs and migrated prod DBs diverge. The Polish PR did both — mirror it.
- Notification `language_code` column is `VARCHAR(2)` → `'pt'` fits; email `language_code` is `VARCHAR(10)`.
- Don't `JSON.parse` JSONB (`clients.properties`, `tenant_settings.settings`) — already parsed.
- Per project Citus rules: any new/edited migration touching tenant tables needs `tenant` scoping;
  `system_email_templates` / `internal_notification_templates` are global (no tenant col) — fine.
- Run validator from repo root: `node scripts/validate-translations.cjs`.

## Commands
```bash
# coverage snapshot (pt vs en, per namespace)
node scripts/validate-translations.cjs
# (loop builds) node scripts/audit-pt-br.cjs            # untranslated + glossary violations
# (loop builds) node scripts/export-pt-review.cjs       # en→pt review sheet
# apply DB template migrations
npm run migrate
```

## Open questions
- Native reviewer identity + preferred export format (CSV vs md). Export supports both.
- Glossary home: `.ai/translation/pt-br-glossary.*` (reusable, preferred) vs plan folder.

## 2026-06-25 — glossary group
- Implemented F001: added `.ai/translation/pt-br-glossary.json` as the reusable pt-BR terminology source of truth. It includes structured domain terms with `en-term`, `pt-br-term`, and rationale notes; forbidden European-PT/wrong-register forms; dialect rules; and placeholder-preservation guidance.
- Implemented F002: added `identicalAllowlist` to the glossary for intentionally identical technical strings, loanwords, product/proper names, and safe technical patterns. Kept it conservative so the future audit still flags English copy-forwards by default.
- Implemented T001/T002 with `scripts/tests/pt-br-glossary.test.mjs`. The test parses the glossary, requires complete term fields, checks duplicate IDs/English terms, verifies canonical forbidden markers (`comboio`, `telemóvel`, `ecrã`, `autocarro`, `registo`, `utilizador`, `rato`), and validates allowlist patterns.
- Verification: `node --test scripts/tests/pt-br-glossary.test.mjs` passed (3 tests).
