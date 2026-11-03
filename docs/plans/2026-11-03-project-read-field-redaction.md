# Project read field redaction

## Context and finding

Security finding `packages/projects/src/lib/projectReadAuthorization.ts#createProjectReadAuthorizer` concerns field-level redactions returned by the authorization kernel. A project-level `allowed` result is not sufficient to safely return the complete project record: the decision also carries `redactedFields`, and project data can contain derived display fields sourced from redacted values.

No committed plan for this security finding exists in `docs/plans/` on this branch (`git log main..HEAD --name-only -- docs/plans/` found only the unrelated CM L5 plan). This document records the security contract and the observed state for the current mitigation round.

## Required contract

1. `createProjectReadAuthorizer` retains the complete authorization decision (`allowed` and `redactedFields`) for each project record.
2. Project list and detail actions filter denied records, then apply the canonical `projectRecord` projection to allowed records before joining client, assignee, contact, or status display data. Removing a redacted source field must also remove display fields derived from it.
3. Task-comment and other child-resource access paths consume the complete parent-project decision and deny or mask child data when the decision redacts fields that the child response can expose.
4. Mutations must enforce the effective update decision and reject or omit writes to fields redacted by the applicable policy. Parent-resource authorization does not grant access to unrelated or hidden child resources.
5. Regression coverage exercises returned data and authorization outcomes, including redacted project fields, derived display fields, child-resource reads, and prohibited mutations.

## Repository state observed for this mitigation

The reviewed tree does not yet satisfy the contract above. `packages/projects/src/lib/projectReadAuthorization.ts` currently returns `decision.allowed` as a boolean. `packages/projects/src/actions/projectActions.ts` filters projects using that boolean and returns the remaining project rows; no canonical `projectRecord` projection is applied there. `packages/projects/src/lib/taskComments/taskCommentAuthorization.ts` likewise consumes a boolean parent-project decision. Existing task-comment behavioral tests cover denied parent projects and write restrictions, but the reviewed tests do not exercise redacted-field projection or derived display-field removal.

This mitigation round repairs workflow linkage and records the design contract. It does not change authorization code or establish that the security finding is resolved. The implementation gap and missing redaction-specific behavioral regression coverage remain for the implementation step/reviewer to address.

## Verification expectations

- Ticket `alga-2026-0003049` is linked to this repository spec using the workflow's GitHub external-reference convention, and its internal comment summarizes the spec.
- Workflow state records this repository-relative path in `psaSpecPaths`.
- The implementation must pass focused behavioral authorization tests and the affected package build/typecheck before this finding can be considered resolved.
