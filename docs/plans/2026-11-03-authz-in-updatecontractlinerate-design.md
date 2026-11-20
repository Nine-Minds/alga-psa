# Design — Security: authz in updateContractLineRate

Card: Security: authz in updateContractLineRate

## Finding (confirmed on main)

Client Admins hold client-scoped `billing:read`/`billing:update` (server/migrations/utils/permissions/catalog.cjs:94-97) which hasPermission accepts for client principals (packages/auth/src/lib/rbac.ts:88-103); getContracts (packages/billing/src/actions/contractActions.ts:276-281) returns every non-template tenant contract and updateContractLineRate (:512-534) checks only `billing:update`, so a client Admin can rewrite another client's contract line rates.

## Approach

1. Restrict contract listing and line mutation to MSP principals: client-scoped billing grants must not satisfy `getContracts`, `getContractLinesForContract` or `updateContractLineRate`.
2. Apply the caller-specific client scope inside the mutation transaction as well, so a discovered contract/line id is re-authorized.
3. Tests: a client Admin cannot list or mutate another client's contract lines; an MSP billing admin can; a client Admin with an in-scope contract still cannot change rates unless that capability is intended.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
