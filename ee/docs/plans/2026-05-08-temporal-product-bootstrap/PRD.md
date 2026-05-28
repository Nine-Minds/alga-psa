# Temporal Product-Aware Tenant Bootstrap

## Problem
Temporal tenant creation currently runs one PSA-oriented onboarding seed set for every tenant. Algadesk tenants can therefore receive visible PSA roles and permissions such as Finance, Project Manager, billing, invoice, project, service, and workflow permissions. Product route/API gates prevent most PSA feature access, but the seeded role and permission vocabulary can still leak into onboarding and settings.

## Goals
- Make Temporal tenant creation choose bootstrap data by tenant `productCode`.
- Preserve existing PSA tenant creation behavior.
- Add an Algadesk bootstrap that seeds a minimal help-desk role and permission model.
- Fail clearly for unknown product codes instead of silently using the wrong bootstrap.

## Non-goals
- Rework product route or API gates.
- Change billing subscription, Stripe, or Apple IAP logic.
- Build a full role-management redesign.
- Backfill existing tenants.

## Target flows
1. New PSA tenant signup runs the full existing PSA onboarding seed set.
2. New Algadesk tenant signup records `tenants.product_code = 'algadesk'` and runs the Algadesk seed set.
3. Missing product code defaults to PSA for backward compatibility.
4. Invalid product code fails tenant creation with an actionable error.

## Data and integration notes
- `TenantCreationInput.productCode` already exists and is already passed to `createTenant`.
- `createTenantInDB` already writes `tenants.product_code` when provided.
- The product-blind seam is `run_onboarding_seeds`, which currently only receives `tenantId`.
- Seed files are copied into the Temporal worker image under `dist/seeds/onboarding`.

## Algadesk bootstrap scope
Algadesk should seed only the roles and permissions that support the help desk surface.

MSP roles:
- Admin
- Agent

Client portal roles:
- Admin
- User

The client portal role names remain `Admin` and `User` for compatibility with existing portal invitation code; UI context differentiates MSP and client roles.

Algadesk should not seed PSA-only permission domains such as billing, invoices, credits, contracts, service catalog, projects, project tasks, assets, workflows, time management, or PSA billing settings.

## Acceptance criteria
- PSA product code selects the PSA seed set.
- Algadesk product code selects the Algadesk seed set.
- Missing product code selects PSA.
- Unknown product code throws a clear error.
- Temporal workflow passes product code into the onboarding seed activity.
- Algadesk seed files do not create visible PSA-only role names or permissions.
- Existing Docker copy behavior includes both seed sets.
