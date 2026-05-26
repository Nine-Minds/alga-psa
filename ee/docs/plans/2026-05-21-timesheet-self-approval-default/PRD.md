# PRD — Timesheet Self-Approval Defaults

## Problem
Alga PSA serves small MSP owners and operators who often enter and approve their own time. Current timesheet approval paths block self-approval unconditionally, even when no premium ABAC policy has been configured. This makes the default product behavior too restrictive.

## Goal
Allow any user with the standard `timesheet:approve` permission to approve their own submitted time by default. Preserve the existing premium ABAC `not_self_approver` constraint so tenants that explicitly configure separation-of-duties policies can still block self-approval.

## Non-goals
- Do not change billing/quote self-approval behavior.
- Do not broaden approval of other users' time beyond existing RBAC/read_all/manager rules.
- Do not add new UI or settings.

## Requirements
1. Server-action timesheet approval allows self-approval when the actor has `timesheet:approve` and no assigned active ABAC bundle rule blocks it.
2. Workflow time approval allows self-approval under the same default rule while retaining an independent shared-code check for configured `not_self_approver` bundle rules.
3. Active, published, assigned authorization bundles with `resourceType=time_entry`, `action=approve`, and `constraintKey=not_self_approver` still deny self-approval.
4. The authorization bundle simulator reflects the same policy: no built-in timesheet self-approval denial, with denial coming from configured bundle constraints only.
5. Approval of another user's time remains governed by the existing `timesheet:approve` plus `timesheet:read_all` or manager relationship rules.

## Acceptance Criteria
- A user with `timesheet:approve` can approve their own timesheet by default.
- A configured `not_self_approver` ABAC bundle denies the same self-approval attempt.
- Existing non-self approval authorization behavior is unchanged.
