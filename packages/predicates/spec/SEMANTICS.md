# Predicate semantics (v1)

This file is the contract. `conformance.json` is its executable form. Every backend runs every case:

| Backend | Where | Notes |
| --- | --- | --- |
| In-memory evaluator | `src/evaluate.ts` | Runs in the Temporal workflow sandbox: deterministic, no Node APIs. |
| SQL compiler | `src/sql/` | PostgreSQL. Two-valued output: a fragment is never `NULL`. |
| Workflow JSONata path | `shared/workflow/runtime/designer/conditionModel.ts` + `expressionEngine` | Rows it cannot represent carry `skip.jsonata` with a reason. |

A change to an operator, a path kind or a value type starts here, then in the table, then in the backends.

## Model

A clause is `{ path, operator, value? }`. A group is `{ join: 'and' | 'or', clauses }` and nests. An empty `and`
group is true; an empty `or` group is false.

Operators: `equals`, `not_equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`,
`ends_with`, `is_empty`, `is_not_empty`. `value` is a literal for single-value operators, a list for `in` and
`not_in`, and absent for `is_empty` and `is_not_empty`.

A path is either **scalar** (zero or one value) or **set-valued** (zero or more elements, such as tags).
A path may cross relations (`contact.tags`); a relation hop that finds no row yields a missing value / empty set.

## Missing values

A value is *missing* when it is absent or null (a missing relation row counts). Every backend agrees on:

1. A missing value **never satisfies a comparison**: `equals`, `not_equals`, `in`, `gt`, `gte`, `lt`, `lte`,
   `contains`, `starts_with`, `ends_with` are all false. This includes `not_equals`.
2. A missing value **satisfies** `is_empty` and `not_in`. `not_in` is exactly `NOT in`.
3. A scalar string is also empty when it is `''`. Numbers, booleans, timestamps and ids are empty only when missing.
4. `equals null` is true when the value is missing and `not_equals null` when it is present. Other operators
   against `null` are false. (The JSONata path cannot tell JSON null from missing and skips these rows.)

SQL compiles comparisons as `COALESCE(<comparison>, FALSE)`, `not_in` as `NOT (in)`, and missing relation rows
through `EXISTS` / `NOT EXISTS`, so `NULL` never leaks into a `NOT`.

## Text

`contains`, `starts_with`, `ends_with` are **case-sensitive** substring, prefix and suffix tests on strings.
`%`, `_` and `\` in the needle are literal. A non-string value never satisfies them.

## Ordering

`gt`, `gte`, `lt`, `lte` compare numbers with numbers and strings with strings (timestamps as instants in SQL,
ISO strings elsewhere). Comparing values of different types is not defined; query schemas reject such values.

## Set-valued paths

Only `in`, `not_in`, `is_empty`, `is_not_empty` are valid:

- `in` = has **any of** the listed values.
- `not_in` = has **none of** the listed values (an empty set satisfies it).
- `is_empty` = no elements. `is_not_empty` = some element.

Across a `many` relation the same words apply to the union of the related rows' values: `not_in` is
`NOT EXISTS (a related row whose value is in the list)`.

## Complements

`not_in` and `is_empty` are defined as the negation of `in` and `is_not_empty` evaluated over the full path,
relation hops included. With a relation hop this means `NOT EXISTS (hop ... AND positive)`, so "no related row"
satisfies them.

## Self or any child (compiler option, not part of the model)

A schema may declare `children` (rows of the same table that point to a parent). With the compile option
`selfOrAnyChild`, a clause whose path crosses a relation hop or reads a set attribute is true for a row when
the positive form of the clause holds for the row **or for any child**. A complement operator negates that
whole: `contact.tags not_in [VIP]` is true for a bundle master only if neither the master nor any child has a
VIP requester. Clauses on the row's own columns never look at children.

## Tenancy

Every compiled relation hop, set subquery and child lookup correlates on the schema's tenant column. A fragment
can never read another tenant's rows, whatever the predicate says.

## Known disagreements

- JSONata compares a missing value with `null` as false (SQL and the evaluator treat both as "no value").
- The workflow engine rejects an ordering comparison (`gt`, `gte`, `lt`, `lte`) on a missing value with "Expression result is not JSON-serializable" instead of returning false; the conformance harness maps that rejection to "not satisfied".
- JSONata has no set-valued paths in the workflow condition adapter.

The first and third are marked in `conformance.json` with `skip.jsonata`.
