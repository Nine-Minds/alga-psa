/**
 * CF030 — the card-specific readiness calculation for PR #3363.
 *
 * Pure: no filesystem, no network, no clock. Everything it judges arrives in
 * the manifest, so its behaviour is testable without a candidate, and
 * `scripts/tests/co-managed-completion.test.mjs` exercises it directly. That
 * ordering is deliberate — the PRD requires the verifier's own behaviour to be
 * validated before it is trusted as a gate.
 *
 * It fails **closed**. Every predicate starts false and is only granted by
 * positive, well-formed evidence. A missing field, an unknown status, a stale
 * SHA or an unreadable artifact is a blocking reason, never a pass.
 *
 * Deliberately NOT inputs to their own calculation: this verifier's invocation
 * record and any packet-delivery receipt. Those are outputs of the gate and are
 * attached afterwards. Independent tests of the verifier remain mandatory
 * inputs, and a human approval or a merge is a later board action that an agent
 * must never assert here.
 */

export const REQUIREMENT_STATUSES = [
  'missing-code',
  'implemented-unverified',
  'failed',
  'blocked-external',
  'verified',
];

/** Statuses that permit `implementationReady`. Only one qualifies. */
const ACCEPTING_STATUSES = new Set(['verified']);

export const EVIDENCE_TYPES = ['automated', 'browser', 'database', 'simulator', 'external', 'analysis'];

/**
 * Evidence kinds that record a *reading* of the system rather than a *run* of
 * it. A row-by-row code read is a legitimate, citable artifact — it is how the
 * inventory learns which third of a requirement is missing — but it observes
 * only the source, never the behaviour. Letting one accept a requirement would
 * reintroduce exactly the "the code looks right, so it works" failure this gate
 * exists to reject.
 *
 * So `analysis` is a valid type (it may be recorded, referenced and reviewed)
 * that is nonetheless never sufficient on its own: a `verified` row must cite
 * at least one evidence item that actually executed something.
 */
const NON_ACCEPTING_EVIDENCE_TYPES = new Set(['analysis']);

/** A mandatory check must have reached exactly this conclusion. */
const CHECK_SUCCESS = 'success';

const SHA40 = /^[a-f0-9]{40}$/;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Requirement IDs that must be present. Supplied by the caller (from the plans
 * on disk) rather than hardcoded, so a requirement silently disappearing from a
 * plan is caught by comparing the two sets instead of by trusting either one.
 */
function checkRequirementSet(manifest, expectedIds, blocking) {
  const rows = Array.isArray(manifest.requirements) ? manifest.requirements : null;
  if (!rows) {
    blocking.push('manifest.requirements is missing or not an array');
    return new Map();
  }

  const byKey = new Map();
  for (const row of rows) {
    if (!isPlainObject(row) || !isNonEmptyString(row.key)) {
      blocking.push('requirement row without a key');
      continue;
    }
    if (byKey.has(row.key)) blocking.push(`duplicate requirement ${row.key}`);
    byKey.set(row.key, row);

    if (!REQUIREMENT_STATUSES.includes(row.status)) {
      blocking.push(`${row.key}: unknown status ${JSON.stringify(row.status)}`);
    }
    if (!isNonEmptyString(row.justification)) {
      blocking.push(`${row.key}: no justification`);
    }
    // `implemented: true` in a plan is a claim about code, never about
    // acceptance. A row that claims verification without an evidence record is
    // the exact shape this gate exists to reject.
    if (row.status === 'verified' && !(Array.isArray(row.evidence) && row.evidence.length > 0)) {
      blocking.push(`${row.key}: verified with no evidence record`);
    }
  }

  if (Array.isArray(expectedIds)) {
    for (const key of expectedIds) {
      if (!byKey.has(key)) blocking.push(`required requirement ${key} is absent from the manifest`);
    }
    const expected = new Set(expectedIds);
    for (const key of byKey.keys()) {
      if (!expected.has(key)) blocking.push(`manifest carries unknown requirement ${key}`);
    }
  } else {
    blocking.push('expected requirement IDs were not supplied; cannot prove the set is complete');
  }

  return byKey;
}

function checkEvidence(manifest, candidate, blocking) {
  const evidence = manifest.evidence;
  if (!isPlainObject(evidence)) {
    blocking.push('manifest.evidence is missing or not an object');
    return new Map();
  }
  const byId = new Map();
  for (const [id, item] of Object.entries(evidence)) {
    if (!isPlainObject(item)) {
      blocking.push(`evidence ${id} is not an object`);
      continue;
    }
    if (!EVIDENCE_TYPES.includes(item.type)) blocking.push(`evidence ${id}: unknown type ${JSON.stringify(item.type)}`);
    if (!isNonEmptyString(item.command)) blocking.push(`evidence ${id}: no command or journey recorded`);
    if (!isNonEmptyString(item.result)) blocking.push(`evidence ${id}: no actual result recorded`);
    if (!isNonEmptyString(item.sha)) blocking.push(`evidence ${id}: no execution SHA`);
    // A record that names no artifact cannot be re-read by a reviewer.
    if (!isNonEmptyString(item.artifact)) blocking.push(`evidence ${id}: no artifact reference`);
    if (item.artifactAvailable === false) blocking.push(`evidence ${id}: artifact ${item.artifact} is unavailable`);
    byId.set(id, item);
  }
  return byId;
}

/**
 * Evidence that was collected at a different SHA than the candidate is
 * historical. It may still be an input to test selection, but it cannot carry a
 * `verified` row on this candidate without an explicit, recorded dependency
 * analysis saying the change does not affect it.
 */
function evidenceAppliesToCandidate(item, candidate) {
  if (!isNonEmptyString(item?.sha)) return false;
  if (candidate.startsWith(item.sha) || item.sha.startsWith(candidate)) return true;
  return isNonEmptyString(item.dependencyAnalysis);
}

/**
 * A manifest cannot record the SHA of the commit that adds it: the manifest is
 * part of that commit's content. Generated last, it names the commit before it,
 * so `manifest.candidate !== HEAD` by exactly one docs-only commit — and a
 * blanket "candidate must equal HEAD" rule would make that blocker permanent and
 * therefore meaningless.
 *
 * The narrow, checkable exception: HEAD may be ahead of the candidate **only**
 * if every file changed between them lives inside the candidate's own evidence
 * directory. A commit that rewrites the packet under the candidate it describes
 * does not change what is being verified. One touched file anywhere else — any
 * source, test, plan or other evidence directory — and the candidate really is
 * stale.
 *
 * @param changedFiles repo-relative paths changed between candidate and HEAD
 * @param evidenceDir  repo-relative evidence directory for this candidate
 */
export function headOnlyRewritesItsOwnEvidence(changedFiles, evidenceDir) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return false;
  if (typeof evidenceDir !== 'string' || evidenceDir.length === 0) return false;
  const prefix = evidenceDir.endsWith('/') ? evidenceDir : `${evidenceDir}/`;
  return changedFiles.every((file) => typeof file === 'string' && file.startsWith(prefix));
}

export function evaluateCoManagedCompletion(input) {
  const manifest = isPlainObject(input?.manifest) ? input.manifest : null;
  const expectedIds = input?.expectedRequirementIds;

  const blocking = { implementation: [], humanReview: [], production: [] };
  const result = {
    schemaVersion: 1,
    candidate: manifest?.candidate ?? null,
    implementationReady: false,
    humanReviewReady: false,
    productionReady: false,
    blocking,
    counts: {},
  };

  if (!manifest) {
    blocking.implementation.push('manifest is missing or unreadable');
    blocking.humanReview.push('manifest is missing or unreadable');
    blocking.production.push('manifest is missing or unreadable');
    return result;
  }

  if (manifest.schemaVersion !== 1) blocking.implementation.push('unsupported manifest schemaVersion');
  const candidate = typeof manifest.candidate === 'string' ? manifest.candidate : '';
  if (!SHA40.test(candidate)) blocking.implementation.push('manifest.candidate is not a full 40-character SHA');
  if (!SHA40.test(manifest.base ?? '')) blocking.implementation.push('manifest.base is not a full 40-character SHA');
  if (!isNonEmptyString(manifest.collectedAt)) blocking.implementation.push('manifest.collectedAt is missing');

  // --- Requirements -------------------------------------------------------
  const rows = checkRequirementSet(manifest, expectedIds, blocking.implementation);
  const counts = {};
  for (const row of rows.values()) counts[row.status] = (counts[row.status] ?? 0) + 1;
  result.counts = counts;

  const evidenceById = checkEvidence(manifest, candidate, blocking.implementation);

  for (const row of rows.values()) {
    const required = row.requiredInCard !== false && row.status !== 'blocked-external';
    if (!required) continue;
    if (!ACCEPTING_STATUSES.has(row.status)) {
      blocking.implementation.push(`${row.key}: ${row.status} — not accepted on this candidate`);
      continue;
    }
    let executedEvidence = 0;
    for (const ref of row.evidence ?? []) {
      const id = typeof ref === 'string' ? ref : ref?.id;
      const item = evidenceById.get(id);
      if (!item) {
        blocking.implementation.push(`${row.key}: evidence ${id} is not in manifest.evidence`);
        continue;
      }
      if (!NON_ACCEPTING_EVIDENCE_TYPES.has(item.type)) executedEvidence += 1;
      if (!evidenceAppliesToCandidate(item, candidate)) {
        blocking.implementation.push(
          `${row.key}: evidence ${id} ran at ${item.sha}, not the candidate, with no recorded dependency analysis`);
      }
    }
    // Structural floor: a code read cannot accept a requirement by itself.
    if (executedEvidence === 0) {
      blocking.implementation.push(
        `${row.key}: verified only by ${[...NON_ACCEPTING_EVIDENCE_TYPES].join('/')} evidence — nothing was executed`);
    }
  }

  // External rows are not accepted here, but they must not vanish either.
  for (const row of rows.values()) {
    if (row.status !== 'blocked-external') continue;
    if (!isNonEmptyString(row.externalOwner)) {
      blocking.production.push(`${row.key}: external prerequisite with no recorded owner`);
    }
  }

  // --- Open defects -------------------------------------------------------
  const defects = Array.isArray(manifest.openDefects) ? manifest.openDefects : null;
  if (!defects) {
    blocking.implementation.push('manifest.openDefects is missing or not an array');
  } else {
    for (const defect of defects) {
      if (!isPlainObject(defect) || !isNonEmptyString(defect.id)) {
        blocking.implementation.push('open defect without an id');
        continue;
      }
      const kind = defect.kind;
      if (['functional', 'security', 'data-integrity'].includes(kind)) {
        blocking.implementation.push(`open ${kind} defect ${defect.id}: ${defect.summary ?? 'no summary'}`);
      }
    }
  }

  result.implementationReady = blocking.implementation.length === 0;

  // --- Human review -------------------------------------------------------
  if (!result.implementationReady) {
    blocking.humanReview.push('implementationReady is false');
  }

  const pr = manifest.pr;
  if (!isPlainObject(pr) || !Number.isSafeInteger(pr.number)) {
    blocking.humanReview.push('manifest.pr.number is missing');
  } else if (pr.head !== candidate) {
    blocking.humanReview.push(`PR head ${pr.head ?? 'missing'} is not the candidate`);
  }

  const provenance = manifest.provenance;
  if (!isPlainObject(provenance)) {
    blocking.humanReview.push('manifest.provenance is missing');
  } else {
    for (const component of ['app', 'worker']) {
      const revision = provenance[component]?.revision;
      if (revision !== candidate) {
        blocking.humanReview.push(`running ${component} revision ${revision ?? 'missing'} is not the candidate`);
      }
    }
    for (const fingerprint of ['migrations', 'config', 'simulator']) {
      if (!isNonEmptyString(provenance[fingerprint])) {
        blocking.humanReview.push(`manifest.provenance.${fingerprint} fingerprint is missing`);
      }
    }
  }

  if (manifest.worktreeClean !== true) blocking.humanReview.push('delivered worktree is not clean');

  const merge = manifest.mergeability;
  if (!isPlainObject(merge)) {
    blocking.humanReview.push('manifest.mergeability is missing');
  } else {
    if (merge.mergeable !== 'MERGEABLE') {
      blocking.humanReview.push(`mergeable is ${merge.mergeable ?? 'unknown'}`);
    }
    if (!isNonEmptyString(merge.mergeStateStatus)) {
      blocking.humanReview.push('mergeStateStatus is missing');
    } else if (['DIRTY', 'UNKNOWN'].includes(merge.mergeStateStatus)) {
      blocking.humanReview.push(`mergeStateStatus is ${merge.mergeStateStatus}`);
    }
    if (merge.checkedAtSha !== candidate) {
      blocking.humanReview.push('mergeability was not re-checked at the candidate');
    }
  }

  const ci = manifest.ci;
  if (!isPlainObject(ci) || !Array.isArray(ci.checks) || ci.checks.length === 0) {
    blocking.humanReview.push('manifest.ci.checks is missing or empty');
  } else {
    if (!isNonEmptyString(ci.runId)) blocking.humanReview.push('manifest.ci.runId is missing');
    const mandatory = ci.checks.filter((check) => check?.mandatory !== false);
    if (mandatory.length === 0) blocking.humanReview.push('no mandatory CI check is recorded');
    for (const check of mandatory) {
      const name = isNonEmptyString(check?.name) ? check.name : '<unnamed check>';
      if (check?.headSha !== candidate) {
        blocking.humanReview.push(`${name}: ran at ${check?.headSha ?? 'unknown'}, not the candidate`);
      }
      if (check?.status !== 'completed') {
        blocking.humanReview.push(`${name}: ${check?.status ?? 'missing'} — not completed`);
      } else if (check?.conclusion !== CHECK_SUCCESS) {
        // skipped / cancelled / neutral / failure all block. A count of green
        // checks cannot substitute for the required set being green.
        blocking.humanReview.push(`${name}: concluded ${check?.conclusion ?? 'missing'}`);
      }
    }
  }

  const review = manifest.reviewEnvironment;
  if (!isPlainObject(review)) {
    blocking.humanReview.push('manifest.reviewEnvironment is missing');
  } else {
    if (review.stable !== true) blocking.humanReview.push('review environment is not recorded stable');
    if (!Number.isFinite(review.observedMinutes) || review.observedMinutes < 30) {
      blocking.humanReview.push('review environment observation is shorter than the required 30 minutes');
    }
    // Any automatic healing invalidates the stability proof.
    if (!Number.isSafeInteger(review.healingEvents) || review.healingEvents !== 0) {
      blocking.humanReview.push(`review environment healed ${review.healingEvents ?? 'an unrecorded number of'} times`);
    }
  }

  result.humanReviewReady = blocking.humanReview.length === 0;

  // --- Production ---------------------------------------------------------
  if (!result.humanReviewReady) blocking.production.push('humanReviewReady is false');
  const prerequisites = Array.isArray(manifest.productionPrerequisites) ? manifest.productionPrerequisites : null;
  if (!prerequisites || prerequisites.length === 0) {
    blocking.production.push('manifest.productionPrerequisites is missing or empty');
  } else {
    for (const item of prerequisites) {
      if (!isPlainObject(item) || !isNonEmptyString(item.id)) {
        blocking.production.push('production prerequisite without an id');
        continue;
      }
      if (!isNonEmptyString(item.owner)) blocking.production.push(`${item.id}: no owner`);
      // Only the release owner can accept these, and a simulator pass never can.
      if (item.acceptedByReleaseOwner !== true) {
        blocking.production.push(`${item.id}: not accepted by the release owner`);
      }
    }
  }
  result.productionReady = blocking.production.length === 0;

  return result;
}
