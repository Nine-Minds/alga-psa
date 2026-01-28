# Business-Relevant Test Counterpart Loop

## Goal

Create a 1:1 business-relevant counterpart for every notification-only fixture. Each current fixture that only calls `notifications.send_in_app` needs a corresponding fixture that exercises real domain-modifying actions.

## Current State

- **171 total fixtures** in workflow-harness
- **24 business-relevant** (14%) - already call domain-modifying actions
- **144 notification-only** - need business counterparts
- **2 scaffold** (1%) - minimal harness tests (ticket-created-hello, ticket-created-ignore-system)
- **3 harness tests** (2%) - runtime/schema validation tests

## Classification Criteria

| Classification | Definition | Needs Counterpart? |
|----------------|------------|-------------------|
| **business-relevant** | Calls domain-modifying actions: `tickets.assign`, `tickets.add_comment`, `tickets.update_fields`, `projects.create_task`, `time_entries.create`, `email.send`, `crm.create_activity_note`, `scheduling.assign_user`, etc. | No |
| **notification-only** | Only calls `notifications.send_in_app` | **Yes** |
| **scaffold** | No `action.call` at all (just state.set/assign/return) | No (intentional) |
| **harness-test** | Tests runtime behavior (paused workflows, schema validation) | No (infrastructure) |

## The Iteration Loop

Process fixtures **domain by domain**, alphabetically within each domain.

### Phase 1: High-Value Domains First

1. **ticket** (71 needed) - highest impact, most complex business logic
2. **project** (28 needed) - task management, status workflows
3. **invoice** (10 needed) - billing automation
4. **appointment** (9 needed) - field service scheduling

### Phase 2: Remaining Domains

5. **payment** (4 needed)
6. **contract** (4 needed)
7. **schedule** (4 needed)
8. **technician** (4 needed)
9. **company** (2 needed)
10. **integration** (2 needed)
11. **task** (2 needed)
12. **time** (2 needed)
13. **email** (1 needed)
14. **capacity** (1 needed)

### Step-by-step: For Each Notification-Only Fixture

#### 1. Read the current fixture

```bash
cat ee/test-data/workflow-harness/<current-fixture>/bundle.json
cat ee/test-data/workflow-harness/<current-fixture>/test.cjs
```

Understand:
- What event triggers it
- What the fixture name implies it *should* do
- What control flow patterns it uses (if/else, foreach, tryCatch, callWorkflow)

#### 2. Design the business-relevant counterpart

The counterpart should:
- Use the **same event** as the original
- Preserve the **same control flow pattern** (if the original tests foreach, the counterpart should too)
- Replace `notifications.send_in_app` with **domain-modifying action(s)**
- Have a name that reflects the actual business action (see `needed-biz-tests.json` for suggestions)

#### 3. Scaffold the new fixture

```bash
node tools/workflow-harness/scaffold.cjs \
  --name <suggested-biz-name> \
  --event <EVENT_NAME> \
  --schema <payload.Schema.v1>
```

#### 4. Implement the bundle.json

Copy the control flow structure from the original, then:
- Replace `notifications.send_in_app` action calls with domain actions
- Update `dependencies.actions` array
- Update `inputMapping` for the new action's required fields
- Keep fixture markers (`vars.marker`, dedupe keys) for test isolation

Example transformation:
```json
// BEFORE (notification-only)
{
  "id": "notify",
  "type": "action.call",
  "config": {
    "actionId": "notifications.send_in_app",
    "inputMapping": {
      "title": { "$expr": "vars.title" },
      "body": { "$expr": "vars.body" }
    }
  }
}

// AFTER (business-relevant)
{
  "id": "add-comment",
  "type": "action.call",
  "config": {
    "actionId": "tickets.add_comment",
    "version": 1,
    "inputMapping": {
      "ticket_id": { "$expr": "payload.ticketId" },
      "comment": { "$expr": "vars.marker & ' ' & vars.body" },
      "is_internal": true
    }
  }
}
```

#### 5. Implement the test.cjs

The test must:
1. Create prerequisite domain objects (ticket, project, etc.)
2. Register cleanup hooks (HTTP delete with DB fallback)
3. Trigger the event via `/api/workflow/events`
4. Wait for the run to complete
5. **Assert the business outcome** by querying the DB

```javascript
// Assert the domain action happened
const comments = await ctx.db.query(`
  SELECT * FROM comments
  WHERE ticket_id = $1 AND comment LIKE $2
`, [ticketId, `[fixture ${testId}]%`]);
ctx.expect.ok(comments.rows.length > 0, 'comment was created');
```

#### 6. Run and iterate

```bash
node tools/workflow-harness/run.cjs \
  --test ee/test-data/workflow-harness/<new-fixture> \
  --base-url http://localhost:3010 \
  --tenant <uuid> \
  --cookie-file <path> \
  --pg-url <postgres-url> \
  --force --debug
```

Triage failures:
- **Fixture bug**: Wrong JSONata, missing fields, bad cleanup → fix in fixture
- **Harness bug**: Auth issues, polling errors → fix in `tools/workflow-harness/`
- **Product bug**: Action fails unexpectedly → fix in `server/`

#### 7. Commit when green

```bash
git add ee/test-data/workflow-harness/<new-fixture>/
git commit -m "test(workflow-harness): add <new-fixture> business counterpart for <original-fixture>"
```

#### 8. Update progress tracker

Mark the fixture as done in `SCRATCHPAD.md` and proceed to next.

## Batching Strategy

Given 144 fixtures to create, batch by domain:

| Domain | Count | Estimated Batches |
|--------|-------|-------------------|
| ticket | 71 | 7 batches of 10 |
| project | 28 | 3 batches of ~10 |
| invoice | 10 | 1 batch |
| appointment | 9 | 1 batch |
| others | 26 | 3 batches |

**Total: ~16 commit batches**

## Files

- Coverage analysis: `coverage-analysis.json`
- Needed tests with suggestions: `needed-biz-tests.json`
- Progress tracker: `SCRATCHPAD.md`

## Definition of Done

- [ ] All 144 notification-only fixtures have business-relevant counterparts
- [ ] Each counterpart passes with `--force --debug`
- [ ] Each counterpart asserts a real database change (not just run SUCCEEDED)
- [ ] All fixtures committed with descriptive messages

When complete, output `<promise>DONE</promise>`.
