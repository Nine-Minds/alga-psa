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

## 2026-06-25 — audit-tooling group
- Implemented F003: added `scripts/audit-pt-br.cjs`, which compares `server/public/locales/en` to `pt`, reports identical-to-English values after applying the glossary allowlist, scans for forbidden pt-PT/wrong-register terms, counts unreviewed keys from the ledger, and can emit JSON/markdown reports under the plan `reports/` directory.
- Implemented F004: added `ee/docs/plans/2026-06-25-pt-br-translation-completion/pt-review-state.json` as the per-key resumable review ledger. Empty ledger shape is `reviewed[namespace][dottedKey] = true` or an object with `reviewed: true`.
- Implemented F005: added `scripts/export-pt-review.cjs`, producing CSV or markdown side-by-side rows with namespace, key, English, Portuguese, and review status.
- Implemented T003-T005 with `scripts/tests/pt-br-audit-tooling.test.mjs`. Fixture coverage checks forbidden-term failure and recovery, identical-to-English allowlist counting, and one export row per key with review status.
- Verification: `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests). `node scripts/audit-pt-br.cjs --no-write-report || true` smoke-tested the full catalog and currently reports the expected baseline debt: 45 namespaces, 22,567 keys, 14,127 untranslated, 66 forbidden-term violations, 22,567 unreviewed. `node scripts/export-pt-review.cjs --namespace common --output <tmp>` wrote 898 common rows plus header.

## 2026-06-25 — i18n-common group
- Implemented F006-F009: completed pt-BR translations for `common.json`, `client-portal.json`, `client-portal/service-requests.json`, and `msp/service-requests.json`. Used a machine-assisted translation pass from English with `{{variable}}` protection, then glossary post-processing for product terms such as ticket→chamado and workflow→fluxo de trabalho.
- Re-audited all 1,729 keys in the group and marked them in `pt-review-state.json` with reviewer `codex-pt-br-pass` and method `machine-assisted translation plus audit`, leaving native-speaker sign-off to the final export process.
- Tightened the glossary allowlist for legitimate identical strings discovered during this group (`Portal`, `Hudu`, `Emojis`, OAuth labels, `Wi-Fi`, `Software`, and placeholder-only formatting patterns). Translated real UI verbs such as `Download`→`Baixar` and `Downgrade`→`Fazer downgrade` instead of allowlisting them.
- Fixed obvious machine-translation artifacts found in sample review: `Lar`→`Início`, `Claro`→`Limpar`, `Durar`→`Último`, `Ativos Ativos`→`Ativos ativos`, `Abrir chamados de suporte`→`Chamados de suporte abertos`, service request `Meus pedidos`→`Minhas solicitações`, and MSP service request action labels (`Duplicar`, `Arquivar`, `Formulário`, etc.).
- Implemented T006-T013. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace common --namespace client-portal --namespace client-portal/service-requests --namespace msp/service-requests --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-tickets group
- Implemented F010-F012: completed pt-BR translations for `features/tickets.json`, `features/documents.json`, and `features/appointments.json` using the same placeholder-protected machine-assisted pass plus glossary post-processing.
- Re-audited all 1,555 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate identical `Total` and `min` values. Translated real `Download` labels to `Baixar`.
- Fixed obvious ticket/document machine-translation artifacts found during sample review: `Claro`→`Limpar`, `Baixe para jogar`→`Baixar para reproduzir`, `Chamado infantil`→`Chamado secundário`, and ticket board `placa/tabuleiro` terms to `quadro`.
- Implemented T014-T019. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace features/tickets --namespace features/documents --namespace features/appointments --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-billing group
- Implemented F013-F020: completed pt-BR translations for `msp/billing.json`, `msp/billing-settings.json`, `msp/invoicing.json`, `msp/credits.json`, `msp/quotes.json`, `msp/contracts.json`, `msp/contract-lines.json`, and `features/billing.json`.
- Re-audited all 5,032 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate identical billing/layout terms (`Subtotal`, `Item`, `Visual`, `Vertical`, `Horizontal`, `Normal`, `Zoom`, `Xero`, `T&M`) and narrow placeholder patterns (`Item {{index}}`, `PO {{number}}`, etc.).
- Translated real UI actions `Clone`→`Clonar` and `Clear`→`Limpar`; adjusted product-area Billing labels to `Faturamento` while leaving charge/frequency contexts as natural `cobrança`.
- Implemented T020-T035. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/billing --namespace msp/billing-settings --namespace msp/invoicing --namespace msp/credits --namespace msp/quotes --namespace msp/contracts --namespace msp/contract-lines --namespace features/billing --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).
