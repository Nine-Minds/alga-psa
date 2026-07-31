# PRD - Tenant query full facade

- Slug: `2026-06-25-tenant-query-full-facade`
- Date: `2026-06-25`
- Status: Draft

## Summary

Add a tenant-aware query facade to `@alga-psa/db` so application code starts
tenant-scoped queries through a tenant-bound database object instead of
handwritten root predicates or package-local wrappers.

## Problem

The current migration moved many direct tenant predicates to
`createTenantScopedQuery`, but most call sites immediately unwrap the branded
query to raw Knex. That keeps tenant scoping as a caller convention. It also
leaves joined tenant equality, table exceptions, and unscoped discovery paths
spread across application code.

## Goals

- Add a full `TenantDb` facade in `@alga-psa/db`.
- Add table metadata for tenant, global, and admin table access.
- Add a tenant-aware join helper for common tenant-equality joins.
- Add explicit unscoped escape hatches with reason strings.
- Migrate representative app code to the facade and continue staged migration
  from that shape.

## Non-goals

- Replacing Knex or introducing an ORM.
- Rewriting all application queries in one commit.
- Changing resource authorization, RLS, or Citus table distribution.

## Requirements

- `tenantDb(conn, tenant).table(tableExpr)` scopes tenant tables by metadata.
- Unknown tables fail closed through tenant-scoped facade methods.
- `scoped(tableExpr)` preserves the branded `TenantScopedQuery` contract.
- `tenantJoin(...)` adds tenant equality when joining tenant-scoped tables.
- `unscoped(tableExpr, reason)` requires a non-empty reason.
- Existing `createTenantScopedQuery` callers remain compatible during migration.

## Data / API / Integrations

New DB package files:

- `packages/db/src/lib/tenantTableMetadata.ts`
- `packages/db/src/lib/tenantDb.ts`
- `packages/db/src/lib/tenantDb.test.ts`

Representative app migration starts with the active NinjaOne action file.

## Security / Permissions

The facade is a tenant-isolation guard, not an authorization replacement.
Existing permission and authorization code remains responsible for resource
access. The facade should make unsafe tenant access explicit and reviewable.

## Rollout / Migration

Ship the facade as an additive API, migrate callers by package, then add static
guardrails once enough code has moved. Keep validation at batch boundaries:
focused tests, static scans, typecheck/build where available, tracker entry,
and Algadev ticket sanity for code-bearing batches.

## Acceptance Criteria

- DB package tests cover root scoping, aliases, metadata failure modes, joins,
  branded scoped queries, and unscoped reasons.
- The first app slice uses `tenantDb` instead of a local tenant-scoped wrapper.
- Existing tenant-scoped query tests keep passing.
- The staged migration tracker records each completed batch.
