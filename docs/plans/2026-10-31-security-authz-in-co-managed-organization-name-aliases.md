# Organization-name redactions: one canonical alias set, and a test that keeps it canonical

Card: `ce72a2da-5fa2-5431-ae50-5915199223e8`
Finding: **authz · high** — `packages/co-managed/src/sharedWorkProjection.ts:14`
(`CO_MANAGED_ORGANIZATION_NAME_ALIASES`), reviewed on merge `1709830ce6d3` (PR #3988).

## What is wrong (confirmed on the branch)

`CO_MANAGED_ORGANIZATION_NAME_ALIASES` is the **only** thing between a redacted customer name and three
read surfaces, and it is short one canonical spelling:

```ts
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = ['client_name', 'organizationName', 'tenants'] as const;
```

It omits `organization_name` and `values.organization_name` — the spellings the snapshot actually stores
(the cached reference row is selected as `organization_name`, `projectTaskQueue.ts:158`, and projected as
`organizationName` at `:167`). `isCoManagedReadFieldHidden` (`sharedWorkRedaction.ts:5-10`) matches paths
against these names, so a policy that redacts `organization_name` (or `values.organization_name`) matches
**nothing** and the mask is a no-op. Consequences, all confirmed by reading the call sites:

1. **Assigned-task queue** — `maskCoManagedSnapshot(context.redactedFields, {... organizationName: reference.organization_name ...}, { organizationName: CO_MANAGED_ORGANIZATION_NAME_ALIASES })`
   (`projectTaskQueue.ts:163-169`) leaves `organizationName` intact; it renders in
   `server/src/components/co-managed/CoManagedProjectTaskQueue.tsx:67`.
2. **Live organization read** — `readCoManagedCustomerOrganizationName` (`projectTaskQueue.ts:11-14`)
   returns the real `client_name` from the customer tenant under the same incomplete check, and it is the
   single source for the project list and the reference snapshot, so the leak is shared by both.
3. The same constant is the sole source for the project queue, so this is one defect with three visible
   exits, not three defects.

The masking *mechanism* (PR #3988) is right; its alias set is incomplete. That is precisely the failure
mode the alias constants exist to prevent, so the fix must make incompleteness hard to reintroduce, not
just add two strings.

## Design

### 1. One canonical organization-name source

Replace the literal with a canonical list, and derive both the matching set and the display/derivation
set from it:

```ts
/** Every spelling the organization's display name is stored or projected under. */
export const CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES = [
  'organization_name', 'values.organization_name',
  'client_name', 'organizationName', 'tenants',
  'organizations.organization_name', 'project_tasks.organization_name',
  'co_managed_project_task_references.organization_name',
] as const;
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES;
```

Qualified forms matter because `isCoManagedReadFieldHidden` matches by path prefix only in the
`name.startsWith(path + '.')` direction, so `project_tasks.organization_name` does **not** match a bare
`organization_name` entry — it must be listed. `values.organization_name` stays because the snapshot
carries raw provider values.

Keep the exported name `CO_MANAGED_ORGANIZATION_NAME_ALIASES` so `projectTaskQueue.ts:12` and `:169`
need no change; the single set already serves both the cached-reference mask and the live read, which is
what the finding asks for.

### 2. Make the set self-defending

The defect was not a wrong line, it was a missing member nobody would notice. Two cheap guards:

- **Completeness test** (`packages/co-managed/src/sharedWorkProjection.aliases.test.ts`): enumerate the
  organization-name spellings used by the co-managed sources — `organizationName` (the projection key),
  `organization_name` (the reference column), `client_name` (`readCoManagedCustomerOrganizationName`),
  `tenants`, `values.organization_name` — and assert each is hidden by the set. This is the regression
  test that fails on main.
- **Cross-set consistency test**: for every field source in this file, assert that its `title` alias set
  contains the plain and `values.`-prefixed spellings of the same base name. This catches the next set
  that is written short (the project-name and assignee sets are the likely next offenders) without
  freezing today's list.

### 3. Behaviour, not just the constant

`packages/co-managed/src/projectTaskQueue.redactions.test.ts` (extend the existing queue test file):

1. policy redacts `organization_name` → `readCoManagedCustomerOrganizationName` returns `''` and the
   assigned-task row's `organizationName` is masked;
2. policy redacts `values.organization_name` → same two results;
3. policy redacts `client_name` (the spelling the live read queries) → same two results;
4. policy redacts nothing → the real name still comes through both paths (no over-masking);
5. `listCoManagedAssignedTasksAction` (`server/src/lib/actions/coManagedProjectTaskActions.ts:48-54`)
   returns no `organizationName` value for a redacting policy — the end-to-end assertion at the action
   boundary, since that is where the finding was observed.

## Order of work

1. Canonical list + export aliasing (one edit, no call-site churn).
2. Alias completeness + cross-set consistency tests (these fail on main).
3. Queue/live-read behaviour tests 1-5.
4. Run the existing co-managed suite (`sharedWorkProjection`, `sharedWorkRedaction`, `projectTaskQueue`,
   `coManagedProjectTaskActions`) and the component test that renders the queue.

## Deliberately not doing

- Not adding a new redaction mechanism or changing `isCoManagedReadFieldHidden`: path matching is correct;
  the input set was short. Changing the matcher here would hide real per-field paths.
- Not renaming the display field `organizationName` in the projection or response shape — the client
  contract stays, and the mask keyed on the alias never depended on renaming.
- Not sweeping every alias set in the file beyond the consistency guard (§2). The guard is the general
  mechanism; rewriting the other sets is churn unless the guard flags one.

## Risks

- **Over-masking**: adding `tenants` was already there deliberately; keep it. If `organization_name` is
  also a *project* field somewhere, the cross-set consistency test will show the collision before merge.
- **Cross-tenant read**: `readCoManagedCustomerOrganizationName` queries the customer tenant directly after
  the policy check. The check is the authority; nothing else changes here.
- **Empty-string masking**: `''` is indistinguishable from "customer has no name". Acceptable today (the UI
  renders it as blank in both cases) and out of scope, but note it in the fact so a future card can decide
  whether an explicit redaction marker is worth the contract change.
