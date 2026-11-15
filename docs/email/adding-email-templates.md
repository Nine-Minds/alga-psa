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

If building the value can fail (an extra query, a lookup in another module), wrap it with `optionalEmailData()` from `server/src/lib/notifications/optionalEmailData.ts`. On an error it logs and returns your fallback, so the email is still sent:

```ts
const assets = await optionalEmailData('the ticket assets', [], () => loadTicketAssets(db, tenantId, ticketId), { tenantId, ticketId });
```

## Checks

```bash
# Variable registry, audience classification, and strict rendering of every template in every language
cd packages/notifications && npx vitest run src/lib/templateVariables

# The audience split against a real database
cd server && npx vitest run src/test/integration/ticketEmailAudienceSplit.integration.test.ts
```
