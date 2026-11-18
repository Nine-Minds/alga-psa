# Adding Email Templates and Variables

Use this guide when you add a system email template, give a template a new variable, or change who receives a ticket email.

## Where things live

| What | Where |
|---|---|
| Template source, one file per template | `server/migrations/utils/templates/email/<category>/` |
| Shared layout and colors | `server/migrations/utils/templates/_shared/emailLayout.cjs`, `constants.cjs` |
| Notification categories and subtypes | `server/migrations/utils/templates/_shared/emailCategoriesAndSubtypes.cjs` |
| Variable registry (the Variables panel in the template editor) | `packages/notifications/src/lib/templateVariables/` |
| Ticket variable audience | `packages/notifications/src/lib/templateVariables/ticketEmailAudience.ts` |
| Ticket email sending | `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` |
| Template lookup at send time | `server/src/lib/notifications/emailTemplateLookup.ts` |

## Ticket emails have two audiences

AlgaPSA renders each ticket email once per recipient, in one of two renderings.

| Rendering | Who gets it | What it gets |
|---|---|---|
| `msp` | The assignee, additional agents, internal watchers, board-rule recipients, and a seat technician while the ticket is in their scope | The MSP link, the internal template, every variable |
| `client` | The requester contact, external watchers, copied addresses, and a seat technician outside the ticket's scope | The portal link, the client template where one exists, client-safe variables only |

A send path names the person, not the template. Each send in `ticketEmailSubscriber.ts` passes `addressedAs: 'msp'` or `addressedAs: 'client'` and the internal template name. `sendTicketEmailMessage` then decides the rest in one place:

1. `recipientRendering()` in `shared/lib/notificationAudience.ts` settles the rendering. An out-of-scope seat technician always gets `client`.
2. `resolveTicketEmailTemplate()` switches a `client` rendering to the client template and its notification subtype, when the internal template has one in `TICKET_EMAIL_CLIENT_VARIANTS`.
3. `projectTicketEmailContext()` removes every variable that is not client-safe from a `client` context.
4. `recipient.isInternal` is added to the context.

### Branching one template by audience

Every ticket email carries `recipient.isInternal`. A template that goes to both audiences can branch on it:

```handlebars
{{#if recipient.isInternal}}
  The requester is waiting for a reply.
{{else}}
  We need a reply from you to continue.
{{/if}}
```

## Adding a variable to a ticket email

1. Add the value to the context the handler builds in `ticketEmailSubscriber.ts`. Pass data, not markup: a string, a number, or a plain array of objects. Labels and table markup belong in the template, in each language.
2. Classify the path in `TICKET_EMAIL_VARIABLE_AUDIENCE`. Mark it `client` only when a requester may see it. An entry covers its subtree, so `ticket.assets` also covers `ticket.assets[].name`.
3. Add the variable to the template's entry in `packages/notifications/src/lib/templateVariables/seed.ts` and in the inventory at `docs/plans/2026-07-17-email-template-variables-inventory.json`. The registry test renders every template listed in the inventory with the registry's example data, so both files must list the variable.

A path with no entry is MSP-only. The client rendering drops it, and `ticketEmailAudience.test.ts` fails until you classify it.

A tenant's customized template can still reference a variable that clients never receive. It renders empty for them. `sendEventEmail` logs a warning the first time it sends such a template to a client, naming the tenant, the template and the variables.

If building the value can fail (an extra query, a lookup in another module), wrap it with `optionalEmailData()` from `server/src/lib/notifications/optionalEmailData.ts`. On an error it logs and returns your fallback, so the email is still sent:

```ts
const assets = await optionalEmailData('the ticket assets', [], () => loadTicketAssets(db, tenantId, ticketId), { tenantId, ticketId });
```

## Adding a template

Follow `ticketUpdatedClient.cjs` for a client template and `ticketUpdated.cjs` for an internal one.

1. Create one file per template under `server/migrations/utils/templates/email/<category>/`. Export `TEMPLATE_NAME`, `SUBTYPE_NAME` and `getTemplate()`. Keep the text of every language in `SUPPORTED_LANGUAGES` (`_shared/constants.cjs`) inline in that file, and build the body with `wrapEmailLayout()`.
2. Add the notification subtype to `SUBTYPES` in `emailCategoriesAndSubtypes.cjs`.
3. Add a migration that calls `upsertEmailCategoriesAndSubtypes()` and `upsertEmailTemplate()`. Give it a `down` that deletes the template and the subtype. Do not copy tenant rows in the migration.
4. Add the template to `server/seeds/dev/68_add_notification_templates.cjs` and to `emailTemplateDefs()` in `server/src/test/unit/migrations/templateLocaleParity.test.ts`.
5. Add the template and its variables to `seed.ts` and to the inventory, as for a new variable.

### Splitting a client template off a shared ticket template

When an internal template also goes to clients, give clients their own template instead of branching. After the split the two are separate emails: a tenant edits, brands and switches each one on its own, and nothing is borrowed from the other at send time.

1. Add the client template as above. Name it `<internal-name>-client` and its subtype `<Internal Subtype> Client`.
2. Add the pair to `TICKET_EMAIL_CLIENT_VARIANTS` with `copiedFromShared: true`. Send paths do not change: they keep naming the internal template.
3. Add a second migration that copies what each tenant had set up for the shared email to the client names. Until the split that setup applied to clients too, so without the copy a tenant with its own template would start sending clients the stock one. Follow `20261115121000_copy_shared_ticket_email_setup_to_client_templates.cjs`:

| What a tenant has for the shared email | What the migration copies |
|---|---|
| Its own template rows | Every row, with subject, HTML, text and language unchanged, under the client name |
| The subtype switched off | The setting, to the client subtype |
| Users who opted out | The opt-outs, to the client subtype |

The copy never replaces a row that already exists under the client name, so it is safe to re-run. It reads a page at a time, writes one tenant per statement, and checks inside its transaction that every copied row is identical to its source. The planning lives in `server/migrations/utils/templates/_shared/copySharedTemplateSetup.cjs` as pure functions, so you can run it over exported rows to see what a migration would write before it runs anywhere.

Email branding recognises a copied row that it wrote itself (`TICKET_EMAIL_TEMPLATES_COPIED_FROM`). The next branding apply rebuilds that row from the client template in the tenant's colors. A copy of a hand-edited row stays the tenant's.

The template editor lists only client-safe variables for a client template.

## Checks

```bash
# Variable registry, audience classification, and strict rendering of every template in every language
cd packages/notifications && npx vitest run src/lib/templateVariables

# Every template ships every supported language
cd server && npx vitest run src/test/unit/migrations/templateLocaleParity.test.ts

# The audience split, the template lookup and the copy migration against a real database
cd server && npx vitest run src/test/integration/ticketEmailAudienceSplit.integration.test.ts src/test/integration/emailTemplateLookup.integration.test.ts src/test/integration/copySharedTicketEmailSetup.integration.test.ts
```
