# Grouped Automatic Invoices Runbook

## Operator Model

Automatic invoices now use a parent/child model:

- parent rows are grouped by `client + invoice window`
- child rows are the atomic execution units
- parent selection means "generate one combined invoice" only when the parent is combinable

When a parent is not combinable, the parent checkbox is disabled and the reason is shown explicitly.

## Select All Semantics

`Select All` is intentionally smart and non-surprising:

- for combinable groups: select the parent row
- for non-combinable groups: select child rows individually

This prevents invalid combined generation while preserving bulk execution.

## Combinability Reasons

A parent can become non-combinable for explicit invoice-scope reasons:

- `PO scope differs`
- `Currency differs`
- `Tax treatment differs`
- `Export shape differs`

Do not assume a disabled parent can be generated as one invoice. Expand the group and select children as needed.

## Preview and Execution

Preview must reflect exact current selection scope:

- combinable parent selection can preview as `1 invoice`
- mixed/incompatible child selection can preview as `N invoices`

Generation must execute exactly the selected parent/child scope and must not implicitly add unselected siblings.

## Troubleshooting

If a group is unexpectedly non-combinable:

1. Expand the parent and inspect child financial badges.
2. Check PO scope compatibility first.
3. Verify currency, tax source, and export shape are aligned.
4. If still blocked, generate at child scope and capture candidate keys for support follow-up.
