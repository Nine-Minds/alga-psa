# Leverage & Layering — Design

**Date:** 2026-06-17
**Status:** Approved (design); artifacts built
**Artifacts produced:** a `~/CLAUDE.md` always-on mention + a global `leverage` skill (`~/.claude/skills/leverage/SKILL.md`)

## Motivation

Software should be layered like a cake: each layer up is more abstract and
higher-leverage; each layer down is more concrete, more library/engine-like.
The radical goal is that **software engineering gets *easier* over time** —
the opposite of a codebase's default thermodynamics, where every feature makes
the next one harder. Achieving "easier over time" requires that lower layers be
*continuously re-leveled*: the abstraction at layer N is revised as layer N+1
teaches you what it actually needed, until the business logic reads as if the
substrate were hand-crafted for it.

The governing imperative: **abstractions serve the application, never the
reverse. If the engine can't accommodate the design, the engine changes.**
This is the antidote to the failure mode that haunts this whole philosophy —
speculative generality, the inner-platform effect, framework-itis, the DSL
nobody asked for.

## The central problem: the sweet spot

Two failure modes pull in opposite directions:

1. **Rabbit holes** — simple things trigger over-eager abstraction work.
2. **Silent accumulation** — many small patterns recur before anyone notices a
   shape is forming, so duplication/contortion fossilizes.

These *feel* like two ends of one dial ("abstract more eagerly" vs. "more
reluctantly"), but they are not. They are **two different activities fused
together.** The resolution is to pry them apart:

- **Detection (noticing)** — cheap, continuous, non-blocking, near-zero
  tolerance for misses. Notice everything; write one line; keep moving.
- **Extraction (acting)** — deliberate, gated, evidence-driven, rare. Refuse
  most candidates.

Rabbit holes come from *acting on weak evidence*. Silent accumulation comes from
*never noticing — or noticing with nowhere to record it, so it evaporates.*
Once the two are decoupled, you can be **greedy about noticing and stingy about
acting** simultaneously. That is the sweet spot.

## Two detection categories

Detection is not only about duplication. "Easier over time" requires a second,
harder target:

- **Duplication** → a shape recurs → a **missing layer below**.
  *Action: extract a new layer.* (Only ever adds layers.)
- **Contortion / friction** → code is fighting an existing abstraction (wrapping
  it, bending it with flags, working around it, re-deriving what it hid) → the
  abstraction is **wrong** for the application.
  *Action: revise the engine.* (Re-levels existing layers — this is what makes
  the cake *better*, not just *taller*, and where "the engine must change"
  lives. Contortion is the detectable signal that the app is yielding to the
  abstraction.)

## Decisions

1. **Two artifacts.** A lightweight always-on mention in `~/CLAUDE.md`
   (detection only) + a heavy, detailed `leverage` skill pulled in for
   deliberate work. This maps detection→always-on, extraction→pulled-in.
2. **Evidence persistence:** in-code grep-able markers are the **spine**
   (option A); a tracked file is for **cross-cutting** candidates that have no
   single home (option B); the memory system is **not** used (team-invisible
   defeats the "before anyone notices" goal).
3. **Markers are committed.** The spine only self-counts via `grep` and survives
   refactors if markers live in committed code. Showing up in diffs is a feature
   (reviewers see leverage debt accruing); the cost is a quality bar — a
   committed marker is a real claim, used sparingly.
4. **Engine revision is first-class and equal** (not the highest-gated action).
   When contortion is detected and the better-shaped engine is clear, the
   revision is proposed with the same weight as any extraction, blast radius
   noted but not treated as a special barrier. Truer to "the engine must change."
5. **Scope:** the skill is **global** (`~/.claude/skills/leverage/`) and the
   mention goes in the **global `~/CLAUDE.md`** — the philosophy is general to
   how software is built; markers simply get committed into whichever repo is in
   play.

## Detection (the markers)

One greppable scheme, two verbs:

```
// LEVERAGE: pattern  <slug> — <note>    ← duplication → missing layer below
// LEVERAGE: friction <slug> — <note>    ← contortion → wrong layer below
```

- `<slug>` — a stable kebab id, reused verbatim across every site of the same
  candidate; this is what makes it self-count.
- `<note>` — a few words, optionally a factor hint: `…forgetting it = cross-tenant leak (cost: high)`.
- List the whole ledger: `grep -rn "LEVERAGE:"`. Count one candidate:
  `grep -rn "LEVERAGE: pattern tenant-filter"`.

**Cross-cutting file (option B):** `docs/plans/leverage-ledger.md` for candidates
with no single home (e.g. "error handling is shaped differently in every
domain"). Entry fields: slug, category, description, rough location of
instances, current gate read, status. Deliberate mode also records its
*decisions* here.

**Lifecycle (markers never rot):**
- **Extracted/revised** → markers removed as part of the refactor (debt paid).
- **Rejected-for-now** (gate not met — usually still-mutating) → marker stays,
  accruing evidence.
- **Rejected-for-good** → marker becomes a one-line rationale so it isn't
  silently re-litigated:
  `// LEVERAGE: pattern x — NOT extracting: 2 sites, shapes diverging (2026-06)`.

## The gate (when a notice graduates to an action)

A judgment aid over four factors, not arithmetic:

- **Frequency** — count of *real* (semantically same) instances. 1 = noise,
  2 = watch, 3+ = strong.
- **Cost per instance** — boilerplate, error-proneness, **correctness risk**.
  High cost can earn extraction at 2 (e.g. a forgotten tenant filter is a bug).
- **Stability** — has the shape stopped moving? The dominant **brake**:
  still-mutating ⇒ wait, regardless of frequency.
- **Leverage** — how many future sites benefit / how much higher the layer above
  gets to operate.

Rules of thumb:
- Act when **(frequency ≥ 2 OR cost high) AND stable AND leverage real**.
- Wait when **still-mutating** — the single best reason to log-and-wait.
- Never act on **frequency alone** when cost and leverage are both low.
- **Friction counts heavier than pattern** — each friction marker is already a
  place the app bent: direct evidence the layer is *wrong*, not merely *absent*.

**Budget guard (anti-rabbit-hole).** A fix-in-passing is allowed only if past
the gate, cheap, *and* within a hard ceiling (~one self-contained change, no API
ripple to many callers). Overflow ⇒ **stop, don't detour, promote to the
ledger.** A simple thing stays a one-liner or becomes a note — never a sprawling
mid-task detour.

## The two workflows

**Passive (during other work):** do the task → notice → drop a marker (don't
detour) → if a fix is trivial, gated, and in-budget, do it in passing →
otherwise leave the marker and move on.

**Deliberate (a dedicated pass — "extensive work" / "find things to fix"):**
1. **Survey the ledger** (`grep` + the cross-cutting file) — this *is* the
   worklist.
2. **Rank** by the gate; friction clusters weigh heaviest.
3. For each that passes, pick the action:
   - **Missing layer → extract**, using **call-site-first design**: write the
     call site you wish existed, then build the engine to satisfy it.
   - **Wrong layer → revise the engine (first-class)**: reshape the lower layer
     so the contortions above dissolve; note blast radius, update callers.
4. **Verify** the call sites now read hand-crafted (the success test) → remove
   paid-off markers → record rejected-for-good decisions.
5. **Stop when high-gate items are drained** — not when you run out of
   conceivable abstractions.

**Call-site-first** is the concrete enforcement of "the app does not yield to
the abstraction": design backward from the ergonomics the business logic wants,
never forward from the implementation you happen to have.

## Guardrails & composition

- **Ledger-driven, never blank-slate.** "Go find abstractions everywhere" is
  itself the biggest rabbit hole. No marker / no evidence ⇒ not this skill's job
  this pass (you may still *add* markers during a pass; acting needs evidence).
- **One change at a time, verified** — no speculative batch refactors.
- **Defer to `simplification-cascades` first** — deleting the need beats
  abstracting it; don't extract what a cascade can eliminate.
- **`simplify` / `code-review`** operate on a single diff; `leverage` is about
  altitude across the codebase over time. Repeated/awkward shapes they surface
  become `leverage` markers.
- **Graduation** — an extraction big enough to be its own project leaves the
  in-passing flow and becomes a real plan (`brainstorming` → `writing-plans`).

## Success criteria

- Markers accumulate during normal work (detection is happening).
- Deliberate passes produce extractions where call sites measurably simplify.
- Inline detours stay within budget (no rabbit holes).
- Over time the ledger for a given area *shrinks* as its layers improve — that
  shrinkage is the observable proxy for "engineering got easier here."

## Calibration — first pressure-test (2026-06-17)

A bounded first pass (inbound-webhook server actions) validated the method and
surfaced three gate refinements, now folded into the skill (v1.1.0):

1. **The gate has two axes, not one verdict.** The four factors answer only "is
   the layer worth it?" — they say nothing about "how do we land it?" A change
   can max out all four factors *and* be the opposite of an in-passing fix (the
   `manual-tenant-where` candidate: ~2,300 sites, security-sensitive, since
   `createTenantKnex` returns an unscoped pool and every `.where({ tenant })` is
   load-bearing). Added an explicit second axis — blast radius & reversibility →
   an execution-path ladder (in-pass / bounded-now / promote-to-plan /
   staged-migration). Engine revision stays first-class on axis 1; blast radius
   lives entirely on axis 2.
2. **Frequency is semantic and per-site.** "High cost earns extraction at 2"
   over-counts when look-alikes share a shape but split on a correctness boundary
   (e.g. of 5 non-transactional mutations, 2 wrap a network call and must *not*
   be wrapped in a DB transaction — real frequency is 3). Count only the sites
   the engine actually fits.
3. **Frequency saturates.** "3+ = strong" with no ceiling let a big count (18)
   apply false pressure against a correct low-cost/low-leverage "wait." Made
   explicit: beyond "strong," frequency stops mounting and the decision hands off
   to cost and leverage.

The pass also confirmed the guardrails held: it stayed bounded, distinguished
`pattern` from `friction`, correctly rejected a security-sensitive row→view
mapper as deliberately-explicit, and promoted the wide-blast engine change rather
than touching it in passing.
