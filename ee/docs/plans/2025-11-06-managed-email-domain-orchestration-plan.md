# Managed Email Domain Orchestration (EE) – Implementation Plan

**Date:** November 6, 2025  
**Authors:** Codex (draft)  
**Status:** Draft  
**Edition:** Enterprise Only

## 1. Problem Statement
Alga PSA currently sends all outbound application mail from the platform’s shared Resend domain, even for hosted Enterprise tenants. Customers need to send transactional messages from their own domains without managing provider credentials or separate infrastructure. We must support tenant-managed sending domains while keeping the provider abstraction generic and future‑proof.

## 2. Overall Work Statement
Deliver an enterprise-only managed email domain orchestration system that lets hosted Alga PSA tenants verify and activate their own sending domains through guided DNS setup, Temporal-managed workflows, and provider-agnostic automation, ultimately enabling outbound mail to originate from tenant-branded domains without exposing provider-specific details.

## 3. Phased To-Do List
### Phase 1 – Foundations (Services & Workflows)
1. Scaffold `ee/server/src/services/email/ManagedDomainService.ts` with `createDomain`, `checkDnsAndProviderStatus`, `activateDomain`, `deleteDomain`.  
2. Add provider factory hook in `ee/server/src/services/email/ManagedDomainService.ts` that instantiates `ResendEmailProvider` via `server/src/services/email/EmailProviderManager.ts` utilities.  
3. Create DNS lookup helper (`ee/server/src/services/email/dnsLookup.ts`) to query TXT/MX/CNAME records using `dns.promises`.  
4. Register EE-only workflow actions by exporting the service through `packages/product-email-domains/ee/entry.ts` and wiring `shared/workflow/init/registerWorkflowActions.ts`.  
5. Implement Temporal workflow file `ee/temporal-workflows/src/workflows/managed-email-domain-workflow.ts` with states/signals described in Section 7.  
6. Add supporting activities in `ee/temporal-workflows/src/activities/email-domain-activities.ts` (provision, dnsCheck, activate, cleanup) and register them in `ee/temporal-workflows/src/activities/index.ts`.  
7. Update `ee/temporal-workflows/src/workflows/index.ts` to export the new workflow and configure the worker task queue.  
8. Extend `ee/temporal-workflows/src/config/startupValidation.ts` to require queue/env vars (`EMAIL_DOMAIN_TASK_QUEUE`, etc.).

### Phase 2 – Application Surface (Server Actions & UI)
1. Add workflow client wrapper `ee/server/src/lib/email-domains/workflowClient.ts` (Temporal enqueue + signals).  
2. Create EE server actions file `ee/server/src/lib/actions/email-actions/managedDomainActions.ts` exposing add/verify/delete operations.  
3. Update `packages/product-email-settings/ee/entry.tsx` to point at a new EE component.  
4. Build EE UI components:  
   - `ee/server/src/components/settings/email/ManagedEmailSettings.tsx` (top-level tab content).  
   - `ee/server/src/components/settings/email/ManagedDomainList.tsx` (status table).  
   - `ee/server/src/components/settings/email/DnsRecordInstructions.tsx` (copyable DNS cards).  
5. Modify `server/src/components/settings/general/SettingsPage.tsx` to load the EE package entry (ensure CE build untouched).  
6. Update feature-flag usage or edition guards so only Enterprise tenants see the managed tab.

### Phase 3 – Verification & Activation (Business Logic)
1. Implement DNS propagation checks in `ManagedDomainService.checkDnsAndProviderStatus` using the helper from Phase 1.  
2. Extend `shared/workflow/init/registerWorkflowActions.ts` to call ManagedDomainService (via package import) for create/verify/activate actions.  
3. Update `ee/server/src/lib/services/TenantEmailService.ts` to prioritize `default_from_domain` from verified managed domains when building the `from` header.  
4. Persist analytics events (e.g., `email_domain.verified`) in `ee/server/src/lib/analytics/posthog.ts`.  
5. Ensure `tenant_email_settings.provider_configs` gets a managed provider entry by default (update `server/src/lib/actions/email-actions/emailSettingsActions.ts` and EE override if needed).

## 4. Goals
- Allow Enterprise tenants to request, verify, and activate custom sending domains within the hosted environment.
- Hide vendor-specific terminology (Resend) from the tenant UI.
- Centralize provider automation in an EE-only “Managed Email Domain Service” that can work with Temporal workflows.
- Preserve pluggability so additional providers (e.g., SES, SendGrid) can be added later without UI or API churn.

### Non-Goals
- Customer-managed SMTP credential onboarding (already handled today).
- Extending the feature to Community Edition.
- Immediate bounce/complaint webhook self-service (tracked separately).

## 5. High-Level Solution
1. **Enterprise Domain Orchestration Service**  
   - New EE service (e.g., `ee/server/src/services/email/ManagedDomainService.ts`) wraps `IEmailProvider` domain lifecycle APIs (create, verify, delete).  
   - Uses centralized credential management (Secrets) and provider configuration to instantiate the correct adapter (`ResendEmailProvider` initially).  
   - Persists provider domain IDs, DNS instructions, and status updates in `email_domains`.

2. **Temporal Workflow Integration**  
   - Create an EE workflow (`ee/temporal-workflows/src/workflows/email-domain-verification-workflow.ts`) managed by the existing temporal worker.  
   - Activities interact with the Managed Domain Service to:  
     - Create provider-side domain records and capture DNS requirements.  
     - Deliver DNS record instructions to the domain owner and monitor for propagation.  
     - Poll verification status / trigger verification runs.  
     - Activate domains post-verification (update tenant email settings, set default `from` domain).  
   - Signals/events mirror the portal domain workflow (e.g., user triggers verification, DNS configured, etc.).

3. **Workflow Client + Actions**  
   - Add EE workflow client utilities (`ee/server/src/lib/email-domains/workflowClient.ts`) similar to custom portal domains.  
   - Replace mock actions in `shared/workflow/init/registerWorkflowActions.ts` by wiring through EE package exports:  
     - `createManagedDomain` → Managed Domain Service `createDomain`.  
     - `triggerManagedDomainVerification` → fetch status via Temporal activity.  
     - `activateManagedDomain` → persist as tenant default domain.

4. **UI / Server Actions**  
   - Introduce EE-only email settings component via package alias (`packages/product-email-settings/{oss,ee}/entry.tsx`).  
   - EE version removes direct API key inputs, surfaces DNS instructions, verification progress, and Temporal-triggered statuses.  
   - Server actions (`ee/server/src/lib/actions/email-actions/managedDomainActions.ts`) call workflow client and Managed Domain Service.  
   - CE retains existing manual flows through OSS package exports.

5. **Tenant Email Sending**  
   - Adjust EE override of `TenantEmailService` to prioritize verified tenant domain for `from` headers and to initialize the managed provider when available.  
   - Preserve fallback to platform default when no verified domain exists.

## 6. Architecture Overview

```text
Tenant UI (Email Settings - EE package)
    │
    ├── EE server actions (managedDomainActions.ts)
    │       │
    │       ├── Workflow Client → Temporal Workflow
    │       │        ├── Activities → Managed Domain Service → Provider Adapter (Resend)
    │       │        └── DB updates via shared models
    │       └── Direct Managed Domain Service calls (e.g., read status)
    │
    └── tenant_email_settings / email_domains tables
             │
             └── TenantEmailService (EE override) selects verified domain for outbound mail
```

## 7. Temporal Workflow Design
- **Workflow Name:** `managedEmailDomainWorkflow`
- **Queue:** reuse temporal worker (e.g., `email-domain-workflows` task queue).  
- **Inputs:** `{ tenantId, domainName, trigger }` (trigger = `register`, `refresh`, `delete`).  
- **States:** `created`, `awaiting_dns`, `verifying`, `verified`, `failed`, `deactivated`.  
- **Signals:**  
  - `dnsConfigured` – domain owner confirms DNS records were created.  
  - `refreshStatus` – admin requests immediate re-check.  
- **Activities:**  
  1. `provisionProviderDomain` – call Managed Domain Service `createDomain`, store provider IDs and DNS instructions, surface instructions to the tenant (UI + email).  
  2. `checkDnsAndVerificationStatus` – verify DNS propagation (e.g., public TXT/MX/CNAME lookup) *and* poll provider status; update DB and determine next step.  
  3. `activateTenantDomain` – mark domain verified, update `tenant_email_settings.default_from_domain`, push analytics event.  
  4. `cleanupProviderDomain` (future) – delete domain if tenant removes it.
- **Retries/Error Handling:**  
  - Exponential backoff for provider API rate limits.  
  - Max runtime guard (e.g., 7 days) before failing workflow and surfacing instructions to support.

## 8. Data & Persistence
- Reuse existing `email_domains` columns (`provider_id`, `provider_domain_id`, `dns_records`, `status`, `failure_reason`).  
- Add structured metadata (JSON) for Temporal workflow execution ID and audit trail.  
- Ensure `tenant_email_settings.provider_configs` includes a managed provider config template (no per-tenant API key).  
- Set `default_from_domain` to verified domain when activation completes; store previous domain for rollback.

## 9. UI/UX Updates (EE)
- Tabs in Email Settings:  
  - “Managed Sending” (EE): wizard to add domain, display DNS records, track status.  
  - “Other Providers” (legacy): optional view for SMTP credentials.  
- Show DNS records grouped by type with copy-to-clipboard; emphasize that verification may take time.  
- Expose workflow status messages (e.g., “Waiting for DNS”, “Verification in progress”).  
- Provide manual “Retry verification” button that triggers `refreshStatus` signal.
- Remind domain owners about required DNS updates with contextual help, links to registrar guides, and status badges that indicate whether DNS records are detected yet.

## 10. Work Breakdown
1. **Planning/Infra**  
   - Finalize workflow name/queue configuration and secrets usage.  
   - Define naming convention for generated sender addresses (e.g., `notifications@{tenantDomain}`).
2. **Backend Foundations**  
   - Implement Managed Domain Service with provider factory.  
   - Wire up Temporal workflow and activities within the existing worker harness.  
   - Update workflow action registry via EE package export.
3. **Server Actions & APIs**  
   - Add EE actions for create/verify/delete domain; update GraphQL/REST endpoints if applicable.  
   - Ensure CE stubs return current behavior.
4. **UI Layer**  
   - Build EE Email Settings component; update package alias resolution and feature flag gating.  
   - Adjust CE UI to hide managed-domain features.  
   - Add analytics events for domain lifecycle milestones.
## 11. Risks & Mitigations
- **Provider API Limits:** Add retry/backoff strategy, monitor via logs.  
- **DNS Verification Delays:** Provide clear instructions, surface TTL expectations, allow manual retries.  
- **Temporal Worker Load:** Reuse existing worker but ensure queue isolation and metric dashboards.  
- **Multi-Provider Future:** Keep service provider-agnostic, encapsulate provider selection logic.  
- **Tenant Misconfiguration:** Validate domain format, restrict apex records, provide warnings before activation.

## 12. Open Questions
- Do we allow tenants to rename the default sender mailbox per domain?  
- Should we automatically notify support when a domain stalls in verification beyond N hours?  
- How do we handle domain deletion if messages are in-flight (grace period vs. immediate removal)?

## 13. Next Steps
1. Engineering sign-off on workflow + service design.  
2. Break out Phase 1 tasks into individual tickets with resource assignments.  
3. Align UI/UX specifications for the managed email settings components before Phase 2 begins.
