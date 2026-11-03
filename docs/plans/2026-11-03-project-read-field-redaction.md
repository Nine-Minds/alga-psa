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

## Implementation and coverage

`createProjectReadAuthorizer` now returns the complete `{ allowed, redactedFields }` decision. List/detail actions authorize base project records, apply `projectRecord`, then enrich visible client, assignee, contact, and status display data. Redacting a source relation or one of its display aliases also removes related identifiers and derived values so enrichment cannot recreate hidden fields.

Task-comment access consumes the complete parent decision and denies reads and writes when it carries redactions, preventing comment bodies and author details from bypassing project field restrictions. The mutation guards reject project decisions with redactions; project update additionally evaluates the update decision and refuses changed fields related to redacted fields. These checks fail closed when broader project-associated data cannot be safely separated.

Behavioral tests exercise the authorization/projection path for allowed-but-redacted list and detail records, source and derived-field removal, denied child-comment reads/writes, and prohibited writes. The focused tests do not invoke the full server-action/database stack; they exercise the shared runtime helpers used by those actions. The security finding is addressed in this draft subject to human review of the field-source map and mutation call sites.

## Verification expectations

- Ticket `alga-2026-0003049` is linked to this repository spec using the workflow's GitHub external-reference convention, and its internal comment summarizes the spec.
- Workflow state records this repository-relative path in `psaSpecPaths`.
- Focused projects authorization tests, package typecheck, and package build pass for this draft; see `draftSummary` for the exact commands and results.
