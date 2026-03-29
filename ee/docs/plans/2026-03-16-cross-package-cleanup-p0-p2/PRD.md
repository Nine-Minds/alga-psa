# Cross-Package Cleanup: P0-P2 Priorities

**Date:** 2026-03-16
**Status:** In Progress
**Branch:** cleanup/circular_deps (rebased on origin/main)

## Problem Statement

The Alga PSA monorepo has accumulated cross-package violations (vertical packages importing from other vertical packages), circular dependency cycles (30 baselined), and stale re-export shims. This degrades build reliability, makes refactoring harder, and increases cognitive overhead.

## Goals

1. Eliminate the `shared → workflows` circular dependency edge (responsible for 18 of 30 baselined cycles)
2. Establish an authoritative cross-package violation count baseline
3. Delete remaining stale shims (auth-compat)
4. Wire missing msp-composition re-exports
5. Reduce cross-package violations through composition layer and type extraction

## Non-Goals

- Deleting `server/src/lib/db/db.tsx` shim (56 callers, deferred)
- Creating new ESLint rules or enforcement (P3)
- Splitting large files (P4)
- Extension infrastructure consolidation (P4)

## Implementation Items

### P0-1: Verify & Commit Shared Workflow Test Moves (DONE - needs commit)

10 test files already moved from `shared/workflow/` to `ee/packages/workflows/src/`. The `shared → workflows` import edge is eliminated (verified: only 1 file in shared references `@alga-psa/workflows`, and it's a comment).

**Files moved:**
- 4 runtime tests → `ee/packages/workflows/src/runtime/__tests__/`
- 6 domain event builder tests → `ee/packages/workflows/src/runtime/schemas/__tests__/`

**Verification commands:**
```bash
# Verify no shared/ files import @alga-psa/workflows (should return 0 actual imports)
grep -r "@alga-psa/workflows" shared/ --include="*.ts" --include="*.tsx" -l | grep -v node_modules | grep -v ".d.ts"

# TypeScript check on affected packages
cd ee/packages/workflows && npx tsc --noEmit
cd shared && npx tsc --noEmit

# Update circular dep baseline
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --baseline .github/known-cycles.json

# Full build
npm run build
```

### P0-2: Authoritative Cross-Package Violation Count

Run ESLint directly (not via nx run-many, which undercounts ~50%).

**Commands:**
```bash
# Full lint run (authoritative count)
npx eslint "{packages}/**/*.{ts,tsx}" --no-error-on-unmatched-pattern 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# Or use root lint script
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# Breakdown by source package
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*Feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# Breakdown by target package
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn
```

### P1-3: Delete auth-compat.ts Shim

**File:** `server/src/lib/auth-compat.ts`
**What it does:** Wraps `getSession()` from `@alga-psa/auth` as `getServerSession()` and `auth` for NextAuth v5 compatibility.

**Callers (2 EE files):**
- `ee/server/src/app/api/extensions/_auth.ts` — imports `auth`
- `ee/server/src/app/api/provisioning/tenants/route.ts` — imports `getServerSession`

**Migration:** Replace imports with `import { getSession } from '@alga-psa/auth'` and rename usage accordingly.

**Verification commands:**
```bash
# Check no remaining imports of auth-compat
grep -r "auth-compat" --include="*.ts" --include="*.tsx" -l | grep -v node_modules

# TypeScript check
cd server && npx tsc --noEmit
cd ee/server && npx tsc --noEmit

# Build
npm run build
```

### P1-4: Wire Missing msp-composition Exports

**File:** `packages/msp-composition/src/index.ts`
**Current re-exports:** tickets, projects, scheduling
**Missing re-exports:** assets, billing, clients

These subdirectories have `index.ts` files with exports but aren't re-exported from the main barrel.

**Verification commands:**
```bash
# Check which packages import from msp-composition subpaths vs main
grep -r "@alga-psa/msp-composition" --include="*.ts" --include="*.tsx" -l | grep -v node_modules | grep -v "msp-composition/src"

# TypeScript check
cd packages/msp-composition && npx tsc --noEmit

# Build
npm run build
```

### P2-5: Composition Layer Work (Task 3-7)

The largest remaining violation source. `documents` is #1 target (~36 violations), `client-portal` is #1 source (~36 violations).

#### P2-5a: Task 3-7b — Client Component Violations

Violations: `clients → scheduling`, `projects → clients`

Pattern: Create `ClientCrossFeatureContext` in clients package (if not already exists), create `MspClientCrossFeatureProvider` in msp-composition, update violating files to use context.

**Files to check/modify:**
- `packages/projects/src/` files importing from `@alga-psa/clients`
- `packages/scheduling/src/` files importing from `@alga-psa/clients` (already partially done via WorkItemDrawer)

#### P2-5b: Task 3-7c — Document Component Violations

Violations: `projects → documents`, `tickets → documents`, `assets → documents`, `clients → documents`, `client-portal → documents`, `users → documents`, `billing → documents`

This is the #1 target. Many imports are for:
- `uploadEntityImage`, `deleteEntityImage` (entity image management)
- `downloadDocument`, `getDocumentDownloadUrl` (document utilities)
- `Documents` component, `DocumentUpload`, `FolderSelectorModal`
- Type imports: `IKBArticleWithDocument`, `ArticleType`

Strategy: Move entity image actions to `@alga-psa/storage` or create context facades for UI components.

#### P2-5c: Task 3-7d — Client-Portal Violations

`client-portal` imports from: tickets (9), billing (6), clients (5), documents (6), projects (3), users (5) = ~34 violations.

Strategy: May need `client-portal-composition` package, or accept some violations with `eslint-disable` (client-portal is inherently a composition layer).

**Verification commands for all P2-5 sub-tasks:**
```bash
# Count violations after each change
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# Breakdown by source
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*Feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# TypeScript check on modified packages
npx tsc --noEmit -p packages/<package>/tsconfig.json

# Full build
npm run build

# Check circular deps didn't regress
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --baseline .github/known-cycles.json
```

### P2-6: Move Shared Types to @alga-psa/types (Task 3-6)

Move type-only cross-package imports to `@alga-psa/types`. Current candidates are limited — most type imports already use `@alga-psa/types`. The main candidates:
- `IKBArticleWithDocument`, `ArticleType` from `@alga-psa/documents` (used by client-portal KB pages)
- Any ticket/client/project types imported across verticals

**Verification commands:**
```bash
# Find type-only cross-vertical imports
grep -rn "import type.*@alga-psa/" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "from '@alga-psa/\(core\|db\|types\|ui\|shared\|auth\|event-bus\|event-schemas\|validation\|storage\|formatting\|workflow-streams\|user-composition\|tenancy\|msp-composition\)'"

# TypeScript check after moves
cd packages/types && npx tsc --noEmit

# Full build
npm run build
```

## Acceptance Criteria

- [ ] P0-1: No files in `shared/` import `@alga-psa/workflows`. Circular dep baseline reduced.
- [ ] P0-2: Authoritative violation count documented.
- [ ] P1-3: `auth-compat.ts` deleted, 2 EE callers migrated, build green.
- [ ] P1-4: `msp-composition/src/index.ts` re-exports all subdirectories, build green.
- [ ] P2-5: Cross-package violations reduced (target: <30 from current ~84).
- [ ] P2-6: Type-only imports moved to `@alga-psa/types` where applicable.

## Verification Runbook (use after every commit)

```bash
# 1. TypeScript check (fast, catches import errors)
cd server && npx tsc --noEmit

# 2. Full build (catches Next.js + bundling issues)
npm run build

# 3. Cross-package violation count
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# 4. Circular dependency check (if nx graph works)
npx nx graph --file=/tmp/graph.json 2>/dev/null && node scripts/check-circular-deps.mjs /tmp/graph.json --baseline .github/known-cycles.json

# 5. Run affected tests
npx vitest run --changed
```
