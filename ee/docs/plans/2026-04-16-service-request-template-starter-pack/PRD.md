# PRD — Service Request Template Starter Pack

- Slug: `service-request-template-starter-pack`
- Date: `2026-04-16`
- Status: Draft

## Summary

Expand the CE built-in service request starter pack from a single `New Hire` template to six common MSP service templates.

The starter pack should provide practical, balanced forms that are immediately useful in CE with `ticket-only` execution, `basic` form behavior, and `all-authenticated-client-users` visibility.

## Problem

The current built-in template set is too thin to demonstrate the service request feature well. MSP admins only see one starter template, which makes the feature feel incomplete and reduces first-run value.

## Goals

- Add six common MSP starter templates to the CE starter pack.
- Keep templates compatible with the current CE field builder and execution model.
- Use polished process-style names and realistic portal copy.
- Keep template instantiation behavior unchanged: templates become ordinary detached drafts.
- Avoid mutating tenant billing/service categories as part of template creation.

## Non-goals

- Adding request-specific category tables or a broader category refactor.
- Auto-creating `service_categories` rows during template creation.
- Adding EE-only workflow assumptions to the CE starter pack.
- Changing template/provider registry architecture.

## Target Templates

1. New Hire Onboarding
2. Employee Offboarding
3. Access Request
4. Hardware Request
5. Software / License Request
6. Shared Mailbox / Distribution List Request

## Functional Requirements

### Template content

Each template must define:
- user-facing name
- description
- icon
- basic-form schema with balanced fields
- CE-safe provider defaults
- a default ticket title template

### Provider defaults

Each built-in template must use:
- execution provider: `ticket-only`
- form behavior provider: `basic`
- visibility provider: `all-authenticated-client-users`

### Category handling

Because template metadata only supports tenant-scoped `category_id` values and current service request categories reuse `service_categories`, built-in templates must leave category unset in v1.

This avoids hidden category creation or billing taxonomy coupling.

### Detached draft behavior

Instantiating a template must still create a normal editable draft row with no persistent template linkage.

## Acceptance Criteria

- The CE starter provider exposes six templates.
- `listServiceRequestTemplateOptions()` returns all six templates.
- Instantiating any template creates a draft definition with:
  - expected metadata
  - expected form schema
  - expected CE-safe providers
  - `category_id = null`
- Re-instantiating the same template produces a fresh draft unaffected by edits to prior template-derived drafts.
- Tests cover template discovery and representative instantiation behavior.
