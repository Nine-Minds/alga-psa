-- READ-ONLY report: rows whose priority family (ITIL or custom) does not match the board's priority_type.
-- Card d4555320. No writes. Run per environment, e.g.:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/reports/priority-board-mismatch.sql
-- (The whole script runs inside a READ ONLY transaction.)
--
-- Family rules mirror findPriorityBoardTypeProblem (packages/tickets/src/lib/ticketFieldReferences.ts):
--   board is ITIL  <=>  boards.priority_type = 'itil'   (NULL = custom)
--   priority is ITIL <=> priorities.is_from_itil_standard IS TRUE (NULL = custom)
--   mismatch when the two differ.
-- Output: one result set per section, one row per tenant that has at least one mismatch.

BEGIN READ ONLY;

-- 1. recurring_ticket_definitions: the EFFECTIVE pair a schedule generates with, i.e. what the app validates
--    (template board/priority, then the definition's own `overrides.board` / `overrides.priority`).
--    Requires the ticket-template link columns (migration 20261017120000). Archived schedules are counted
--    in `mismatched` but not in `mismatched_active`.
SELECT 'recurring_ticket_definitions (effective)' AS source, d.tenant,
       count(*) AS mismatched,
       count(*) FILTER (WHERE d.is_active AND d.archived_at IS NULL) AS mismatched_active
FROM recurring_ticket_definitions d
JOIN ticket_templates t ON t.tenant = d.tenant AND t.template_id = d.ticket_template_id
JOIN boards b     ON b.tenant = d.tenant
                 AND b.board_id = COALESCE((d.overrides #>> '{board,board_id}')::uuid, t.board_id)
JOIN priorities p ON p.tenant = d.tenant
                 AND p.priority_id = COALESCE((d.overrides #>> '{priority,priority_id}')::uuid, t.priority_id)
                 AND p.item_type = 'ticket'
WHERE (COALESCE(b.priority_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(p.is_from_itil_standard, false)
GROUP BY d.tenant ORDER BY d.tenant;

-- 1b. per-client effective pair (template -> definition overrides -> client overrides): the unit that generates tickets
SELECT 'recurring_ticket_definition_clients (effective)' AS source, c.tenant,
       count(*) AS mismatched,
       count(*) FILTER (WHERE c.is_active AND d.is_active AND d.archived_at IS NULL) AS mismatched_active
FROM recurring_ticket_definition_clients c
JOIN recurring_ticket_definitions d ON d.tenant = c.tenant AND d.definition_id = c.definition_id
JOIN ticket_templates t ON t.tenant = d.tenant AND t.template_id = d.ticket_template_id
JOIN boards b     ON b.tenant = c.tenant
                 AND b.board_id = COALESCE((c.overrides #>> '{board,board_id}')::uuid,
                                           (d.overrides #>> '{board,board_id}')::uuid, t.board_id)
JOIN priorities p ON p.tenant = c.tenant
                 AND p.priority_id = COALESCE((c.overrides #>> '{priority,priority_id}')::uuid,
                                              (d.overrides #>> '{priority,priority_id}')::uuid, t.priority_id)
                 AND p.item_type = 'ticket'
WHERE (COALESCE(b.priority_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(p.is_from_itil_standard, false)
GROUP BY c.tenant ORDER BY c.tenant;

-- 2. ticket_templates (board and priority are both nullable; only rows with both set can mismatch)
SELECT 'ticket_templates' AS source, t.tenant,
       count(*) AS mismatched,
       count(*) FILTER (WHERE t.is_active) AS mismatched_active
FROM ticket_templates t
JOIN boards b     ON b.tenant = t.tenant AND b.board_id = t.board_id
JOIN priorities p ON p.tenant = t.tenant AND p.priority_id = t.priority_id AND p.item_type = 'ticket'
WHERE (COALESCE(b.priority_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(p.is_from_itil_standard, false)
GROUP BY t.tenant ORDER BY t.tenant;

-- 3. open tickets
SELECT 'tickets (open)' AS source, k.tenant,
       count(*) AS mismatched,
       count(*) AS mismatched_active
FROM tickets k
JOIN boards b     ON b.tenant = k.tenant AND b.board_id = k.board_id
JOIN priorities p ON p.tenant = k.tenant AND p.priority_id = k.priority_id
WHERE COALESCE(k.is_closed, false) = false
  AND (COALESCE(b.priority_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(p.is_from_itil_standard, false)
GROUP BY k.tenant ORDER BY k.tenant;

-- 4. INFORMATIONAL ONLY (category type validation is out of scope): category family vs boards.category_type.
--    Category is ITIL <=> categories.is_from_itil_standard IS TRUE (NULL = custom).
SELECT 'ticket_templates: category_type (info)' AS source, t.tenant, count(*) AS mismatched, count(*) FILTER (WHERE t.is_active) AS mismatched_active
FROM ticket_templates t
JOIN boards b     ON b.tenant = t.tenant AND b.board_id = t.board_id
JOIN categories c ON c.tenant = t.tenant AND c.category_id = t.category_id
WHERE (COALESCE(b.category_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(c.is_from_itil_standard, false)
GROUP BY t.tenant ORDER BY t.tenant;

SELECT 'recurring_ticket_definitions: category_type (info, effective)' AS source, d.tenant, count(*) AS mismatched,
       count(*) FILTER (WHERE d.is_active AND d.archived_at IS NULL) AS mismatched_active
FROM recurring_ticket_definitions d
JOIN ticket_templates t ON t.tenant = d.tenant AND t.template_id = d.ticket_template_id
JOIN boards b     ON b.tenant = d.tenant
                 AND b.board_id = COALESCE((d.overrides #>> '{board,board_id}')::uuid, t.board_id)
JOIN categories c ON c.tenant = d.tenant
                 AND c.category_id = COALESCE((d.overrides #>> '{category,category_id}')::uuid, t.category_id)
WHERE (COALESCE(b.category_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(c.is_from_itil_standard, false)
GROUP BY d.tenant ORDER BY d.tenant;

SELECT 'tickets (open): category_type (info)' AS source, k.tenant, count(*) AS mismatched, count(*) AS mismatched_active
FROM tickets k
JOIN boards b     ON b.tenant = k.tenant AND b.board_id = k.board_id
JOIN categories c ON c.tenant = k.tenant AND c.category_id = k.category_id
WHERE COALESCE(k.is_closed, false) = false
  AND (COALESCE(b.category_type, 'custom') = 'itil') IS DISTINCT FROM COALESCE(c.is_from_itil_standard, false)
GROUP BY k.tenant ORDER BY k.tenant;

ROLLBACK;
