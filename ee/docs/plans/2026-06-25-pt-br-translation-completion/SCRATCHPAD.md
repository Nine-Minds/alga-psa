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

## 2026-06-25 — templates-verify completion
- Added `scripts/check-pt-template-parity.cjs` as the final source-of-truth parity gate for templates. It scans all email template source files, compares them with the dev seed and Portuguese email migration lists, checks pt coverage for every email/internal template, verifies `{{variable}}` token parity, and applies the pt-BR forbidden-term audit to template copy.
- Final email source count is **41**, not the earlier 34/36 planning snapshot. The parity scan found 7 later source templates without pt (`ticket-agent-assigned-client`, `ticket-auto-close-warning`, `ticket-team-assigned`, `task-comment-added`, `sla-warning`, `sla-breach`, `sla-escalation`), so they were translated and wired into both `server/seeds/dev/68_add_notification_templates.cjs` and `server/migrations/20260625120000_add_portuguese_email_templates.cjs`.
- Fixed an existing `tenant-recovery` pt placeholder-control mismatch: the pt copy had extra `{{#if isMultiple}}` / `{{/if}}` tokens versus English. Reworded the pt sentence so HTML/text preserve the English conditional token set.
- Commands run:
  - `node scripts/check-pt-template-parity.cjs`
  - `node --test scripts/tests/pt-br-template-parity-check.test.mjs scripts/tests/pt-br-email-templates.test.mjs scripts/tests/pt-br-email-migration.test.mjs scripts/tests/pt-br-internal-notification-templates.test.mjs`

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

## 2026-06-25 — i18n-projects-time group
- Implemented F021-F026: completed pt-BR translations for `features/projects.json`, `projects.json`, `msp/schedule.json`, `msp/dispatch.json`, `msp/calendar.json`, and `msp/time-entry.json`.
- Re-audited all 2,267 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Fixed a placeholder regression from glossary post-processing (`{{chamado}}` back to `{{ticket}}`) and kept `validate-translations.cjs` as the guard for future placeholder drift.
- Tightened the glossary allowlist for legitimate identical project/time labels and compact formatting (`Kanban`, `h`, `download`, UUID placeholders, `Status: {{status}}`, `({{hours}}h)`, `{{type}} • {{client}}`).
- Fixed obvious machine-translation artifacts found during sample review: `Claro`→`Limpar`, `Download`→`Baixar`, `Link`→`Vincular`, and `Cessionário`→`Responsável` for assignee labels.
- Implemented T036-T047. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace features/projects --namespace projects --namespace msp/schedule --namespace msp/dispatch --namespace msp/calendar --namespace msp/time-entry --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-clients group
- Implemented F027-F030: completed pt-BR translations for `msp/clients.json`, `msp/contacts.json`, `msp/account.json`, and `msp/profile.json`.
- Re-audited all 2,391 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate identical client/profile values (`Individual`, `Local`, `Fax`, `Solo`, `Webhooks`, `HMAC-SHA256`) and compact technical patterns (`URL:`, `~{{percent}}%`, `via {{method}}`, `{{duration}} ms`, IP/CIDR placeholders).
- Translated real UI labels `Downgrade`→`Fazer downgrade`, `Claro`→`Limpar`, and phone type `Lar`→`Residencial`.
- Implemented T048-T055. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/clients --namespace msp/contacts --namespace msp/account --namespace msp/profile --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-assets-catalog group
- Implemented F031-F033: completed pt-BR translations for `msp/assets.json`, `msp/knowledge-base.json`, and `msp/service-catalog.json`.
- Re-audited all 1,353 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate identical asset/OS/hardware terms (`Virtual`, `Firewall`, `RAM (GB)`, `NVMe`, `Windows`, `macOS`, `Linux`, `iOS`, `Android`) and tax-rate placeholder labels.
- Translated real UI labels `Download`→`Baixar`, `Claro`→`Limpar`, and `Cessionário`→`Responsável`.
- Implemented T056-T061. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/assets --namespace msp/knowledge-base --namespace msp/service-catalog --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-admin group
- Implemented F034-F041: completed pt-BR translations for `msp/admin.json`, `msp/settings.json`, `msp/integrations.json`, `msp/email-providers.json`, `msp/extensions.json`, `msp/licensing.json`, `msp/onboarding.json`, and `msp/jobs.json`.
- Re-audited all 4,972 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for admin/integration technical labels and compact formats (`OAuth2 (XOAUTH2)`, `TTL:`, `Temporal`, `Cron`, `Xero CSV`, `ID: {{id}}`, duration formats, placeholder names, `TK-`, etc.).
- Translated real UI labels and corrected obvious artifacts: `Clone`→`Clonar`, `Durar`→`Último`, `Ticketing`→`Chamados`, `Serial`→`Número de série`, and job `empregos`→`trabalhos`.
- Implemented T062-T077. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/admin --namespace msp/settings --namespace msp/integrations --namespace msp/email-providers --namespace msp/extensions --namespace msp/licensing --namespace msp/onboarding --namespace msp/jobs --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-workflows group
- Implemented F042: completed pt-BR translations for `msp/workflows.json`.
- Re-audited all 1,706 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate workflow technical labels and compact formats (`Designer`, `Vars`, `Beta`, `corr-123`, `Etc/GMT+5`, `Cron: {{cron}}`, `{{count}} total`).
- Translated real UI `Clear` labels to `Limpar`.
- Implemented T078-T079. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/workflows --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-misc group
- Implemented F043-F050: completed pt-BR translations for `msp/core.json`, `msp/dashboard.json`, `msp/keyboard-shortcuts.json`, `msp/auth.json`, `msp/chat.json`, `msp/reports.json`, `msp/surveys.json`, and `msp/user-activities.json`.
- Re-audited all 1,562 keys in the group and marked them reviewed in `pt-review-state.json` with reviewer `codex-pt-br-pass`.
- Tightened the glossary allowlist for legitimate misc labels and shortcuts (`Alga`, `Google Play (Android)`, `Global`, `Editor`, `Ctrl`, `Ad hoc`, `Cmd/Ctrl+K`, `%`).
- Fixed a placeholder regression (`{{chamado}}` back to `{{ticket}}`) and obvious machine artifacts: `Lar`→`Início`, `Cessionário`→`Responsável`, `Pão ralado`→`Trilha de navegação`, `Centro de Emprego Aberto`→`Abrir central de trabalhos`, and `boleto`→`chamado` in report context.
- Implemented T080-T095. Verification: `node scripts/validate-translations.cjs` passed. `node scripts/audit-pt-br.cjs --namespace msp/core --namespace msp/dashboard --namespace msp/keyboard-shortcuts --namespace msp/auth --namespace msp/chat --namespace msp/reports --namespace msp/surveys --namespace msp/user-activities --no-write-report` passed with `untranslated=0 forbidden=0 unreviewed=0`. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — i18n-finalize group
- Implemented F051: relabeled `LOCALE_CONFIG.localeNames.pt` to `Português (Brasil)` in `packages/core/src/lib/i18n/config.ts`, keeping the locale code as `pt`.
- Implemented F052: left `pt` in `INCOMPLETE_LOCALES`; the post-review go-live remains the one-line removal of `pt` from that array after native-speaker approval.
- Implemented F053: generated final audit and native-review artifacts under `ee/docs/plans/2026-06-25-pt-br-translation-completion/reports/` (`pt-br-audit.json`, `pt-br-audit.md`, `pt-review-export.csv`, `pt-review-export.md`).
- Implemented T096/T097 in `packages/core/src/lib/i18n/config.test.ts`: the picker filter still omits incomplete `pt`, and `localeNames.pt` renders as `Português (Brasil)`.
- Implemented T098/T099 with `scripts/tests/pt-br-finalize.test.mjs`: full audit/export generation is asserted, and sampled MSP/client-portal route namespaces have populated pt resources and a clean scoped audit.
- Verification: `node scripts/validate-translations.cjs` passed. `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs scripts/tests/pt-br-finalize.test.mjs` passed (9 tests). `cd packages/core && npx vitest run src/lib/i18n/config.test.ts` passed (5 tests). A repo-root `npx vitest run packages/core/src/lib/i18n/config.test.ts` attempt found no files because the root Vitest config is server-scoped; reran from the package root successfully.

## 2026-06-25 — email-pt-auth-ticketing group
- Implemented F054: added explicit `pt` variants to the auth and ticketing source-of-truth email template files for email verification, password reset, portal invitation, tenant recovery, no-account-found, ticket created, ticket created client, ticket assigned, ticket updated, ticket updated client, ticket closed, and ticket comment added.
- Translation decisions: use Brazilian product terminology from the glossary (`chamado`, `solicitante`, `quadro`, `equipe de suporte`) and preserve every English Handlebars placeholder in subject/html/text output. For structured ticket templates, `pt` uses the standard full-detail layouts rather than the Polish simplified variants so placeholder parity stays exact.
- Implemented T100/T101 with `scripts/tests/pt-br-email-templates.test.mjs`: verifies the 12 templates export non-empty `pt` subject/html/text, exact placeholder parity with English, no rendered `undefined`, and no forbidden pt-PT or wrong-register terms.
- Verification: `node --test scripts/tests/pt-br-email-templates.test.mjs` passed (2 tests). `node --test scripts/tests/pt-br-glossary.test.mjs scripts/tests/pt-br-audit-tooling.test.mjs` passed (6 tests).

## 2026-06-25 — email-pt-billing-projects group
- Implemented F055: added explicit `pt` variants to the source-of-truth email templates for invoice generated, invoice email, payment received, payment overdue, credits expiring, project created, project updated, project closed, project assigned, primary task assignment, additional task assignment, task updated, and milestone completed.
- Translation decisions: use glossary-consistent Brazilian terms (`fatura`, `créditos`, `projeto`, `tarefa`, `marco`) and preserve the existing template builders/visual variants, including task-assignment badge color constants.
- Implemented T102/T103 by extending `scripts/tests/pt-br-email-templates.test.mjs` to cover the 13 billing/project templates in addition to the previous auth/ticketing group.
- Verification: `node --test scripts/tests/pt-br-email-templates.test.mjs` passed (2 tests), checking non-empty `pt` output, exact placeholder parity with English, no `undefined`, and no forbidden glossary terms.

## 2026-06-25 — email-pt-appointments-time-surveys group
- Implemented F056: added explicit `pt` variants to the source-of-truth email templates for appointment request received, appointment request approved, appointment request declined, new appointment request, appointment assigned technician, time entry submitted, time entry approved, time entry rejected, and survey ticket closed.
- Translation decisions: use Brazilian service language (`agendamento`, `técnico`, `lançamento de horas`, `pesquisa`) and keep Handlebars conditionals/variables exactly aligned with English output.
- Implemented T104/T105 by extending `scripts/tests/pt-br-email-templates.test.mjs` to cover this 9-template group along with the prior completed email groups.
- Verification: `node --test scripts/tests/pt-br-email-templates.test.mjs` passed (2 tests), checking non-empty `pt` output, exact placeholder parity with English, no `undefined`, and no forbidden glossary terms.
- Gotcha for next groups: F054-F056 name 34 source templates, while F057/T106 refer to 36 production email rows. Reconcile the authoritative DB/template count before marking migration/parity work complete.

## 2026-06-25 — email-pt-migration group
- Reconciled template count: the dev seed `server/seeds/dev/68_add_notification_templates.cjs` has 34 source-of-truth email template getters, and the PRD category breakdown also sums to 34 (auth 5 + ticketing 7 + invoices 4 + credits 1 + projects 8 + appointments 5 + time 3 + surveys 1). The earlier “36” wording is stale; updated F057/T106 descriptions to say 34 source-of-truth rows so migration and seed parity remain exact.
- Implemented F057: added `server/migrations/20260625120000_add_portuguese_email_templates.cjs`. It filters each source template to its `pt` variant, resolves `notification_subtypes.name` to IDs, upserts rows into `system_email_templates` on `(name, language_code)`, and `down()` deletes only `language_code='pt'` rows for those template names.
- Implemented F058: exported `TEMPLATE_GETTERS` from the dev seed for test visibility; seed behavior is unchanged, and every getter now returns a `pt` translation from the source files.
- Implemented T106-T108 with `scripts/tests/pt-br-email-migration.test.mjs`: verifies migration/seed template-name parity, 34 pt rows, exact placeholder parity with English, scoped idempotent upsert/down behavior, and that `pt` rows satisfy the system-template locale lookup before English fallback.
- Verification: `node --test scripts/tests/pt-br-email-migration.test.mjs` passed (4 tests). `node --test scripts/tests/pt-br-email-templates.test.mjs` passed (2 tests).

## 2026-06-25 — notif-pt-templates group
- Implemented F059: added `pt` translations to all internal notification source files (`tickets`, `projects`, `invoices`, `system`, `appointments`, `sla`) and created `server/migrations/20260625121000_add_portuguese_internal_notification_templates.cjs` to upsert the `pt` rows into `internal_notification_templates`.
- Updated `server/seeds/dev/87_internal_notification_templates.cjs` to include the SLA source templates and export `ALL_TEMPLATES` for parity tests; the source now has 45 templates and covers every internal subtype from `categoriesAndSubtypes.cjs`.
- Translation decisions: use glossary terms (`chamado`, `fatura`, `agendamento`, `usuário`) and preserve every English `{{variable}}` token. SLA templates are internal-only but still get pt rows because their subtypes are part of the internal notification source of truth.
- Implemented T109-T111 with `scripts/tests/pt-br-internal-notification-templates.test.mjs`: verifies source/seed/migration parity, every subtype has pt coverage, 45 pt rows are built, placeholder sets match English, forbidden terms are absent, upsert/down are scoped/idempotent, and representative internal/client-facing lookups resolve pt before fallback.
- Verification: `node --test scripts/tests/pt-br-internal-notification-templates.test.mjs` passed (4 tests).

## 2026-06-26 — post-loop context-error fix (review follow-up)
- Independent re-measure confirmed loop quality: 97.6% of keys differ from English (22,023/22,567), EU-PT grammar/lexicon clean (0 "estar a + infinitive", 0 guardar/gerir/eliminar/ecrã/telemóvel). BUT 3 domain-homonym register errors slipped past the audit because its forbidden list never contained them:
  - **board**: `placa` (plate/circuit-board) used instead of `quadro` — 41 strings.
  - **run** (workflow): `corrida` (race/jog) instead of `execução` — 9 strings.
  - **assignee**: `cessionário` (legal transferee) instead of `responsável` — 8 strings.
  Each was inconsistent with the correct term the loop already used elsewhere (quadro 148×, execução 136×, responsável 19×), i.e. partial fixes the loop logged as complete.
- Fixed every occurrence (81 string replacements across 15 files; post-fix grep = 0) with hand-written gender agreement (placa fem → quadro masc: `uma placa`→`um quadro`, `da placa`→`do quadro`, `é obrigatória`→`é obrigatório`, `Primeira/definida`→`Primeiro/definido`, `importada(s)`→`importado(s)`, `a nova placa`→`o novo quadro`, `Todas as placas`→`Todos os quadros`, `placa fixa`→`quadro fixo`). corrida→execução both feminine (agreement preserved); `Corrida de repetição`/`Replay Run`→`Repetir execução`; `Corrida Correspondida`→`Execução Correspondente`.
- Hardened the audit: added `placa/placas`, `corrida/corridas`, `cessionário/cessionária/cessionários/cessionárias` to `forbiddenTerms` in `.ai/translation/pt-br-glossary.json` (12 → 20 entries). Verified `findForbiddenTerms` now FLAGS all six sample regressions. Note in `placa` reason: legit hardware compounds (placa-mãe) would need allowlisting if asset copy ever uses them — none today.
- Re-verified green: `validate-translations.cjs` PASSED; `audit-pt-br.cjs` untranslated=0 forbidden=0 unreviewed=0; loop glossary+audit tests 6/6; translated % unchanged at 97.6 (no key reverted to English). Regenerated `reports/pt-br-audit.{json,md}` + `reports/pt-review-export.{csv,md}`.
- Still gated by design (now via dev-preview, see below); uncommitted.

## 2026-06-26 — gating change: dev-only preview (supersedes Decision #2)
- Decision #2 ("pt stays in INCOMPLETE_LOCALES, hidden everywhere") is superseded. New behavior: pt is selectable in **development builds only**, hidden in production — like pseudo-locales, but as a real locale.
- Added `PREVIEW_LOCALES = ['pt']` to `packages/core/src/lib/i18n/config.ts`; emptied `INCOMPLETE_LOCALES = []` (kept exported for future genuinely-hidden locales). `filterPseudoLocales` now dev-gates pseudo **and** preview locales; incomplete stays hidden in both modes. Re-exported `PREVIEW_LOCALES` from `packages/ui/src/lib/i18n/config.ts`.
- Gate = `process.env.NODE_ENV === 'development'`, i.e. **local `npm run dev` only**. A deployed staging/preview cluster runs a production build (NODE_ENV=production) → pt will NOT appear there. For a deployed reviewer-visible preview we'd need an env-flag gate (e.g. `NEXT_PUBLIC_ENABLE_PREVIEW_LOCALES`) instead — not done.
- In dev, pt is now in the client i18next `supportedLocales` (via `client.tsx` → `filterPseudoLocales`), so the `locale=pt` cookie/URL override actually renders pt; in prod it's filtered out and won't load.
- Go-live (promote to production locale) = remove `'pt'` from `PREVIEW_LOCALES` after native-speaker review. One line.
- Verified: rebuilt `@alga-psa/core` (tsc -b ok); `packages/core` config vitest 6/6 (new test: pt selectable in dev only); node finalize+glossary+audit tests 9/9; dist smoke — dev picker=[...,pt,xx,yy], prod picker=[en,fr,es,de,nl,it,pl].

## 2026-06-26 — Habilitar standardization + 3 hardcoded components + reports relocation
- **Habilitar convention:** flipped the 2 pt notification toggle strings from Ativar/Ativado → `Habilitar notificações` / `Habilite ou desabilite…` to match the catalog's 56 existing Habilitar/Habilitado uses (all of which correctly render EN "Enable/Enabled"; the "Habilitado=Qualified" reverse-translation was a false alarm — 0 EN "Qualified" strings exist). May revisit Ativar after native review.
- **3 hardcoded components localized** (locale-JSON audit was blind to these — they never called t()): `EmailTemplates.tsx`, `NotificationCategories.tsx`, `InternalNotificationCategories.tsx` wired to `useTranslation('msp/settings')` via 3 parallel agents. 104 new keys under `notifications.{emailTemplatesUi,categoriesUi,internalCategoriesUi}.*` added to all 10 locales (en+7 + xx/yy pseudo), pt marked reviewed. NotificationSettings.tsx (prior turn) wired via `notifications.settingsForm.*`. Verified: validator PASSED, audit 22,677 keys 0/0/0, notifications tsc 0 errors, no leftover hardcoded JSX.
- **Reports/ledger relocated + gitignored + purged from history** (user scope: reports + ledger only; scripts/tests/glossary/plan docs stay committed). Moved `reports/*` + `pt-review-state.json` → `.ai/translations/pt-br/` (gitignored). Repointed `audit-pt-br.cjs`/`export-pt-review.cjs` (PLAN_DIR→REVIEW_DIR) + `pt-br-finalize.test.mjs` reportsDir. History rewrite: `git stash` → `git filter-branch --index-filter` over `merge-base(main)..HEAD` → `stash pop`; dropped refs/original. Branch HEAD 83c5e475c5 → **151d06ea32**; 19 commits preserved; 2 paths purged from every branch commit (`git log HEAD -- <paths>` empty); PRD/features/tests/SCRATCHPAD kept. Optional `git reflog expire --expire=now --all && git gc --prune=now` NOT run (keeps recovery).
- pt still gated dev-preview (`PREVIEW_LOCALES=['pt']`). All work uncommitted (37 modified files).

## 2026-06-26 (later) — ALL pt-br review tooling moved to gitignored local-only home
- **Where the tooling lives now:** every pt-br review helper is under **`.ai/translations/pt-br/`** (gitignored, never committed). Earlier prose in this file referencing `scripts/audit-pt-br.cjs`, `.ai/translation/pt-br-glossary.json`, etc. is STALE — superseded by this section. Layout:
  - `.ai/translations/pt-br/pt-br-glossary.json` (glossary + forbiddenTerms)
  - `.ai/translations/pt-br/{audit-pt-br,export-pt-review,check-pt-template-parity}.cjs`
  - `.ai/translations/pt-br/lib/pt-br-translation-utils.cjs`
  - `.ai/translations/pt-br/tests/pt-br-*.test.mjs` (7)
  - `.ai/translations/pt-br/pt-review-state.json` (ledger) + `.ai/translations/pt-br/reports/*`
- **Run them with:** `node .ai/translations/pt-br/audit-pt-br.cjs`, `node .ai/translations/pt-br/export-pt-review.cjs --format both`, `node --test .ai/translations/pt-br/tests/*.test.mjs`. (Repo-general `scripts/validate-translations.cjs` + `find-missing-i18n-keys.cjs` stay committed.)
- **Path fixes on move:** scripts `REPO_ROOT = path.resolve(__dirname,'../../..')`; tests `new URL('../../../..', import.meta.url)`; glossary path → `.ai/translations/pt-br/pt-br-glossary.json`; test→script refs updated. Verified green: validator PASSED, audit 0/0/0, 22/22 tests, parity OK, notifications tsc 0.
- **History purge #2:** stash → `git filter-branch --index-filter` removing the 12 tracked tooling paths (glossary + 3 scripts + lib + 7 tests) over `merge-base(main)..HEAD` → stash pop (no conflicts); dropped refs/original. HEAD 151d06ea32 → **292fc9c417**. `git log --all -- <all pt-br tooling+reports+ledger>` is EMPTY → fully purged from every ref. KEPT committed: plan docs (PRD/features/tests/SCRATCHPAD) + locale JSON + component/config/migration changes.
- Reflog still holds old objects (recovery SHAs 83c5e475c5 / 151d06ea32); run `git reflog expire --expire=now --all && git gc --prune=now` for irreversible object removal — NOT run.
