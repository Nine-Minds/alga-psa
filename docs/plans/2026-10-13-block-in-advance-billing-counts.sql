-- Block In Advance billing on Hourly/Usage contract lines (PSA alga-2026-0002697)
-- Plan section 2.8.1: READ-ONLY measurement queries for ops.
--
-- Run each statement against a prod READ REPLICA. Nothing here writes.
-- Every join carries `tenant` (Citus colocation).
--
-- Facts these queries rely on (verified against the code, not assumed):
--   * recurring_service_periods.obligation_id = contract_lines.contract_line_id
--     for client-cadence AND contract-cadence rows. Migration
--     20261010120000_collapse_recurring_service_period_obligation_type.cjs
--     collapsed the old obligation_type label ("a recurring obligation is
--     identified by (tenant, obligation_id = contract_line_id, charge_family)").
--     Q2 below includes a check query (Q0) that proves it on the data you run it on.
--   * A service period is half-open: [service_period_start, service_period_end).
--     The loaders use start_time >= start AND end_time < endExclusive
--     (billingEngine.ts loadTimeBasedObligation) and usage_date >= start AND
--     usage_date < endExclusive (loadUsageBasedObligation).
--   * Hourly lines in the engine include the 'time' alias; the stored
--     contract_line_type is 'Hourly' / 'Usage'.

-- ---------------------------------------------------------------------------
-- Q0  sanity: every recurring_service_periods.obligation_id resolves to a
--     contract line of the same tenant. Expect orphans = 0.
-- ---------------------------------------------------------------------------
SELECT count(*) AS periods,
       count(*) FILTER (WHERE cl.contract_line_id IS NULL) AS orphans
  FROM recurring_service_periods rsp
  LEFT JOIN contract_lines cl
         ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id;

-- ---------------------------------------------------------------------------
-- Q1  lines per tenant that store advance on an Hourly/Usage type
-- ---------------------------------------------------------------------------
SELECT tenant, 'contract_lines' AS src, contract_line_type AS t, count(*)
  FROM contract_lines
 WHERE contract_line_type IN ('Hourly','Usage') AND billing_timing = 'advance'
 GROUP BY 1,2,3
UNION ALL
SELECT tenant, 'contract_template_lines', line_type, count(*)
  FROM contract_template_lines
 WHERE line_type IN ('Hourly','Usage') AND billing_timing = 'advance'
 GROUP BY 1,2,3
UNION ALL
SELECT tenant, 'contract_line_presets', contract_line_type, count(*)
  FROM contract_line_presets
 WHERE contract_line_type IN ('Hourly','Usage') AND billing_timing = 'advance'
 GROUP BY 1,2,3
 ORDER BY 1,2,3;

-- ---------------------------------------------------------------------------
-- Q2  advance periods on Hourly/Usage lines, by lifecycle state and whether a
--     charge backs them (chargeless = billed with no invoice_charge_detail_id)
-- ---------------------------------------------------------------------------
SELECT rsp.tenant,
       cl.contract_line_type,
       rsp.lifecycle_state,
       (rsp.invoice_charge_detail_id IS NULL) AS chargeless,
       (rsp.invoice_id IS NOT NULL)           AS invoiced,
       count(*)
  FROM recurring_service_periods rsp
  JOIN contract_lines cl
    ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id
 WHERE cl.contract_line_type IN ('Hourly','Usage')
   AND rsp.due_position = 'advance'
 GROUP BY 1,2,3,4,5
 ORDER BY 1,2,3,4,5;

-- ---------------------------------------------------------------------------
-- Q3  candidate stranded activity: uninvoiced approved time / usage that sits
--     inside a BILLED advance period of an Hourly / Usage line, using the same
--     predicates as the loaders.
--
-- Time (loadTimeBasedObligation):
--   time_entries.invoiced = false, billable_duration > 0,
--   approval_status = 'APPROVED', service_id in the line's services,
--   start_time >= period start AND end_time < period end,
--   work item is a ticket or project task whose client is the line's client,
--   attributed to the line (contract_line_id = line) OR unassigned
--   (contract_line_id IS NULL) with the service uniquely mapped to this line
--   among the client's overlapping contracts (getUniquelyAssignableServiceIdsForLine).
-- Usage (loadUsageBasedObligation, additive path):
--   usage_tracking.invoiced = false, service in the line's services,
--   usage_date >= period start AND usage_date < period end, same attribution rule.
--
-- Not reproduced: ticket->project attribution (ticketProjectAttributionJoin),
-- fixed-price project exclusion and the bucket-covered-service exclusion. The
-- count therefore slightly OVER-estimates; treat it as an upper bound.
-- ---------------------------------------------------------------------------
WITH billed_advance AS (
  SELECT rsp.tenant, rsp.record_id, rsp.obligation_id AS contract_line_id,
         cl.contract_line_type, cl.contract_id,
         rsp.service_period_start, rsp.service_period_end,
         (rsp.invoice_charge_detail_id IS NULL) AS chargeless
    FROM recurring_service_periods rsp
    JOIN contract_lines cl
      ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id
   WHERE cl.contract_line_type IN ('Hourly','Usage')
     AND rsp.due_position = 'advance'
     AND rsp.lifecycle_state = 'billed'
),
line_services AS (
  SELECT tenant, contract_line_id, service_id FROM contract_line_services
  UNION
  SELECT tenant, contract_line_id, service_id FROM contract_line_service_configuration
),
period_client AS (
  SELECT b.*, cc.client_id, cc.start_date AS cc_start, cc.end_date AS cc_end
    FROM billed_advance b
    JOIN client_contracts cc
      ON cc.tenant = b.tenant AND cc.contract_id = b.contract_id
),
-- (client, service) pairs that map to exactly ONE contract line among the
-- client's contracts overlapping the period
unique_service AS (
  SELECT pc.record_id, ls2.service_id, count(DISTINCT cl2.contract_line_id) AS line_count,
         min(cl2.contract_line_id::text) AS only_line_id
    FROM period_client pc
    JOIN client_contracts cc2
      ON cc2.tenant = pc.tenant AND cc2.client_id = pc.client_id
     AND cc2.start_date < pc.service_period_end
     AND (cc2.end_date IS NULL OR cc2.end_date >= pc.service_period_start)
    JOIN contract_lines cl2
      ON cl2.tenant = cc2.tenant AND cl2.contract_id = cc2.contract_id
    JOIN contract_line_services ls2
      ON ls2.tenant = cl2.tenant AND ls2.contract_line_id = cl2.contract_line_id
   GROUP BY pc.record_id, ls2.service_id
),
time_hits AS (
  SELECT pc.tenant, pc.record_id, pc.contract_line_type, pc.chargeless,
         count(*) AS entries
    FROM period_client pc
    JOIN line_services ls
      ON ls.tenant = pc.tenant AND ls.contract_line_id = pc.contract_line_id
    JOIN time_entries te
      ON te.tenant = pc.tenant AND te.service_id = ls.service_id
    LEFT JOIN tickets t
      ON t.tenant = te.tenant AND t.ticket_id = te.work_item_id AND te.work_item_type = 'ticket'
    LEFT JOIN project_tasks pt
      ON pt.tenant = te.tenant AND pt.task_id = te.work_item_id AND te.work_item_type = 'project_task'
    LEFT JOIN project_phases pph
      ON pph.tenant = pt.tenant AND pph.phase_id = pt.phase_id
    LEFT JOIN projects p
      ON p.tenant = pph.tenant AND p.project_id = pph.project_id
    LEFT JOIN unique_service us
      ON us.record_id = pc.record_id AND us.service_id = te.service_id
   WHERE pc.contract_line_type = 'Hourly'
     AND te.invoiced = false
     AND te.billable_duration > 0
     AND te.approval_status = 'APPROVED'
     AND te.start_time >= pc.service_period_start
     AND te.end_time   <  pc.service_period_end
     AND COALESCE(t.client_id, p.client_id) = pc.client_id
     AND ( te.contract_line_id = pc.contract_line_id
           OR ( te.contract_line_id IS NULL
                AND us.line_count = 1
                AND us.only_line_id = pc.contract_line_id::text ) )
   GROUP BY pc.tenant, pc.record_id, pc.contract_line_type, pc.chargeless
),
usage_hits AS (
  SELECT pc.tenant, pc.record_id, pc.contract_line_type, pc.chargeless,
         count(*) AS entries
    FROM period_client pc
    JOIN line_services ls
      ON ls.tenant = pc.tenant AND ls.contract_line_id = pc.contract_line_id
    JOIN usage_tracking ut
      ON ut.tenant = pc.tenant AND ut.service_id = ls.service_id
     AND ut.client_id = pc.client_id
    LEFT JOIN unique_service us
      ON us.record_id = pc.record_id AND us.service_id = ut.service_id
   WHERE pc.contract_line_type = 'Usage'
     AND ut.invoiced = false
     AND ut.usage_date >= pc.service_period_start
     AND ut.usage_date <  pc.service_period_end
     AND ( ut.contract_line_id = pc.contract_line_id
           OR ( ut.contract_line_id IS NULL
                AND us.line_count = 1
                AND us.only_line_id = pc.contract_line_id::text ) )
   GROUP BY pc.tenant, pc.record_id, pc.contract_line_type, pc.chargeless
)
SELECT tenant, contract_line_type, chargeless,
       count(*)      AS billed_advance_periods_with_stranded_activity,
       sum(entries)  AS stranded_entries
  FROM (SELECT * FROM time_hits UNION ALL SELECT * FROM usage_hits) h
 GROUP BY 1,2,3
 ORDER BY 1,2,3;

-- ---------------------------------------------------------------------------
-- Q4  (extra) charged billed advance periods that the repair will NOT
--     auto-catch-up: the line has a bucket overlay, or a usage period total
--     exists for the period (plan 2.8.4 "no automatic catch-up").
-- ---------------------------------------------------------------------------
SELECT rsp.tenant, cl.contract_line_type,
       (EXISTS (SELECT 1 FROM contract_line_bucket_services bs
                 WHERE bs.tenant = rsp.tenant AND bs.contract_line_id = rsp.obligation_id)
        OR EXISTS (SELECT 1 FROM contract_line_buckets b
                    WHERE b.tenant = rsp.tenant AND b.contract_line_id = rsp.obligation_id)) AS has_bucket_overlay,
       EXISTS (SELECT 1 FROM usage_period_totals upt
                WHERE upt.tenant = rsp.tenant
                  AND upt.client_contract_line_id = rsp.obligation_id
                  AND upt.period_start = rsp.service_period_start
                  AND upt.period_end   = rsp.service_period_end) AS has_period_total,
       count(*)
  FROM recurring_service_periods rsp
  JOIN contract_lines cl
    ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id
 WHERE cl.contract_line_type IN ('Hourly','Usage')
   AND rsp.due_position = 'advance'
   AND rsp.lifecycle_state = 'billed'
   AND rsp.invoice_charge_detail_id IS NOT NULL
 GROUP BY 1,2,3,4
 ORDER BY 1,2,3,4;
