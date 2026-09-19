# Instruction 1 — build barrel defect: root cause, boundary, and the class

## The diagnosis was partly wrong, and the correction matters

The dossier said `packages/co-managed/src/timeBillingProfile.ts` imports
`@alga-psa/shared/billingClients/billingProfiles`, that `shared/tsup.config.ts`
has no `billingProfiles` entry, and that the missing dist file is why rebuilding
shared did not help.

The missing tsup entry is real but is **not** the root cause, and the claim that
`shared/package.json` has "no wildcard" is false. It has one:

```json
"./*": "./dist/*"
```

That wildcard maps `./billingClients/billingProfiles` to
`./dist/billingClients/billingProfiles` — **with no extension** — which never
resolves. The decisive evidence is `hourBlockService`, which *does* have a tsup
entry and *does* have `shared/dist/billingClients/hourBlockService.js` on disk,
and still failed:

```
FAIL @alga-psa/shared/billingClients/billingProfiles    -> MODULE_NOT_FOUND
FAIL @alga-psa/shared/billingClients/hourBlockService   -> MODULE_NOT_FOUND
OK   @alga-psa/shared/lib/ticketCloseRules -> shared/dist/lib/ticketCloseRules/index.js
```

So the defect is in the **exports map**, and it affects the entire
`billingClients` surface — 60+ distinct subpath specifiers across the repo, used
at 38 sites for `billingProfiles` alone — not one module. The comment in
`tsup.config.ts` claiming packages/jobs "resolves through the exports map" was
therefore already stale: it could not have been.

## Boundary chosen: (b), generality

Option (a) — one tsup entry plus one exports key — would have fixed
`billingProfiles` and left `hourBlockService` broken, which is the proof that the
instance-level fix is the wrong altitude here. `billingClients/` is a coherent
public subpath surface, so it is exported as one:

```json
"./billingClients/*":    "./dist/billingClients/*.js",
"./billingClients/*.js": "./dist/billingClients/*.js",
```

Both patterns are needed. Node picks the longest prefix before `*`, then the
longest suffix after it, so `./billingClients/*` alone would rewrite
`billingProfiles.js` to `billingProfiles.js.js`. The `.js` pattern claims those.

`shared/tsup.config.ts` correspondingly stops enumerating `billingClients`
entries by hand and reads the directory:

```ts
function billingClientEntries(): Record<string, string> { ... }   // 72 modules
```

No `// LEVERAGE: friction` marker was left at `tsup.config.ts`, because the trap
it described is now gone for this directory rather than merely noted.

## Auditing the class rather than the instance

`import()`ing the barrel reports only the **first** broken specifier, so fixing
one just uncovers the next — which is exactly what happened here, three times.
`scripts/check-workspace-dist-resolution.mjs` walks every module reachable from
the built barrel and resolves every `@alga-psa/*` specifier with Node's own ESM
resolver (`import.meta.resolve` under the `import` condition — `createRequire`
applies the `require` condition and produces false failures for import-only
exports; an earlier draft made exactly that mistake and reported ~40 phantom
errors).

It found **three** members of the class:

| # | Specifier | Defect | Fix |
|---|---|---|---|
| 1 | `@alga-psa/shared/billingClients/*` | `./*` wildcard yields an extensionless path; no directory entry in tsup | `./billingClients/*` + `*.js` export patterns; directory-read tsup entries |
| 2 | `@alga-psa/licensing` (root) | `exports["."].import` pointed at `./src/index.ts` — a TypeScript source | point `import`/`require` at `./dist/index.js` (matching its own `./lifecycle` key) |
| 3 | `@alga-psa/shared/utils/appointmentDateTime` | `import` condition pointed at `./utils/appointmentDateTime.ts` | point at `./dist/utils/appointmentDateTime.js`; add the tsup entry |

Number 3 is the interesting one: it is a **static top-level import** in
`dist/index.js` (line 13319) and the barrel still imported "successfully",
because Node 22.18 strips TypeScript types by default. It would break on Node
20, under `--no-experimental-strip-types`, or on any file using enums or
decorators. The checker catches it; a smoke import does not.

Changing the licensing root export is safe for the app: `server/next.config.mjs`
resolves bare `@alga-psa/*` specifiers through **webpack aliases pointed at
`src/`** (with an explicit note at lines 213–217 that switching them to `dist`
broke the build), so the exports map is consulted only by the plain-Node
consumers — precisely the ones that were broken.

## Proof

**1. Builds**

```
ESM dist/workflow/runtime/index.js     1.05 MB
ESM ⚡️ Build success in 155ms
--- shared EXIT=0 ---
ESM dist/index.js                      862.43 KB
ESM ⚡️ Build success in 220ms
--- co-managed EXIT=0 ---
```

72 of 72 `shared/billingClients/*.ts` modules now emit to `dist`.

**2. Plain-Node dynamic import of the built barrel**

```
$ node --input-type=module -e "await import('<abs>/packages/co-managed/dist/index.js'); console.log('ok')"
ok
```

**3. Whole-graph audit**

```
$ npm run check:dist-resolution
OK: 224 built modules walked, every @alga-psa/* subpath resolves under plain Node.
```

Non-vacuous: re-pointing `@alga-psa/licensing`'s `import` back at `src/index.ts`
makes it report that specifier and exit 1.

**4. A real archive-maintenance run** — see
`docs/evidence/co-managed-archive-maintenance-run.md`. Executed with plain
`node`, it loaded the built barrel (283 exports), connected to
`server_co_managed`, and swept a seeded 40-day-expired draft:
`{"abandonedDrafts":1,...,"completedDrafts":1}`.

## Regression guard

`server/src/test/unit/build/workspaceDistResolution.contract.test.ts` (3 tests)
shells out to the checker with `--json` and asserts zero failures, plus a
`visited > 50` sanity bound so an empty build cannot make it vacuous.

Its third test guards **`50b7b97195`**: the built barrel must contain no *static*
edge to `@alga-psa/storage/StorageProviderFactory`, which would put Node
filesystem builtins back on the conversation-event core path and break four jsdom
suites in `packages/projects` at collection. Verified still clean — this round's
changes did not make `portableBlobStaging.ts` reachable.

Run manually: `npm run check:dist-resolution`.
