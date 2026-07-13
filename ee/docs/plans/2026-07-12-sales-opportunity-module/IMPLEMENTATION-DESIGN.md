# Opportunity Close-Won, Methodology Workflows, and Follow-Up Sending

## Close-won project creation

Closing an opportunity may create an onboarding project from a project template. The project and the opportunity close must commit in one database transaction. A failed template application leaves the opportunity open and creates no partial project.

The Projects package will expose a transaction-aware template application service. Its existing authenticated server action will delegate to that service. The service will accept an existing Knex transaction, tenant, actor, template, client, project name, status, start date, assignment, and copy options. It will query project statuses through the same transaction instead of invoking another server action.

`winOpportunity` will require project-create permission when a template is selected. It will call the transaction-aware service before closing the opportunity, store the returned project ID in `converted_project_id`, and record project evidence. Quote conversion, client lifecycle promotion, project creation, evidence, and opportunity closure will therefore share the same commit boundary.

The win dialog will load available project templates and project statuses. Selecting a template reveals project name, project status, and start date fields. Project creation remains optional.

## Default opportunity workflows

Three published system workflows provide the default opportunity methodology:

- Opportunity stale nudge
- Opportunity escalation
- Renewal suggestion generation

Each workflow has a stable key and a deterministic tenant-specific workflow ID. An idempotent seed service writes the tenant-scoped definition and published version. A migration backfills existing tenants. The PSA onboarding seed invokes the same service for tenants created later.

The discipline engine continues to detect stale and escalated opportunities and publish domain events. Default workflows consume those events and invoke idempotent opportunity actions for their side effects. The scheduled renewal workflow invokes an idempotent renewal-generator action. Native code will not duplicate workflow-owned notifications, calendar activities, or generator runs.

The workflows run in CE. They are visible and marked as system workflows. EE tenants may customize them through the existing Designer without changing the seed keys.

## Direct follow-up email

The follow-up editor sends only to the primary email of the opportunity's linked contact. When the opportunity has no linked contact or the contact has no valid email, the editor explains what is missing and disables Send.

The send action re-reads the opportunity, contact, and email under the authenticated tenant. It requires opportunity-update and email-process permission. It sends through `TenantEmailService`, using the tenant's configured outbound provider. A successful provider result is followed by a sent interaction containing the recipient, subject, body summary, and provider message ID. A provider failure does not create a sent interaction.

The editor retains Copy and Rewrite. The previous self-reported “I sent it” action is replaced by Send. The UI displays the resolved recipient before sending and prevents repeated clicks while a send is in progress.

## Failure handling

- Project template validation, permission, or creation errors roll back the entire win transaction.
- Workflow seeds use conflict-safe deterministic identifiers and can run repeatedly.
- Workflow side-effect actions use stable idempotency keys derived from the opportunity, event, and threshold occurrence.
- Email configuration and provider errors are shown to the user without recording a successful send.
- Interaction logging includes the provider message ID so support can correlate the product timeline with provider logs.

## Verification

Database-backed tests will prove project creation and opportunity closure are atomic, workflow seeding is idempotent and tenant-isolated, and email success/failure produces the correct interaction state.

The live smoke run will:

1. Create or select a project template, close an open opportunity with it, and verify the project, copied template structure, opportunity reference, and handoff.
2. Verify all three system workflows are published, enabled, and visible for the test tenant. Run the renewal workflow and exercise at least one event-driven methodology workflow.
3. Configure GreenMail as the tenant SMTP provider, send a follow-up from an opportunity with a linked contact, verify SMTP receipt, and verify the opportunity timeline interaction. A missing-contact case and provider-failure case must not log a successful send.
