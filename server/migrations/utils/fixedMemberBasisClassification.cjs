'use strict';

/**
 * Classification of `contract_line_service_fixed_config.base_rate` rows into
 * `per_unit` | `share`, shared by the migration and the read-only report
 * script (scripts/billing/report-fixed-member-base-rate-basis.ts) so the two
 * can never disagree.
 *
 * Plan: docs/plans/2026-10-12-fixed-line-base-rate-meaning-plan.md (§4).
 *
 * The statement is a pure SELECT. It returns one row per base_rate that has no
 * basis yet:
 *   tenant, config_id, contract_line_id, base_rate_basis, reason
 *
 * (Plan §3.3 proposed moving Fixed `contract_line_service_configuration.custom_rate`
 * allocations into base_rate as shares. That was NOT done: those values are
 * per-unit catalog prices, see the work-order note on §9.)
 *
 * Rules (per contract line, over its bundle members: Fixed, non-product,
 * non-unit configurations):
 *   - unit / product / non-Fixed rows            -> per_unit
 *   - line is "share-shaped" (every member has a rate and every
 *     |rate_i - S*q_i/Q| <= ceil(n/2) cents, the fingerprint of the wizard's
 *     allocateBundleBaseRate) AND (quantities differ OR line rate = S) -> share
 *   - everything else, including the ambiguous equal-quantity case, keeps
 *     today's billing                            -> per_unit
 */
const CLASSIFICATION_TEMPLATE = `
WITH cfg AS (
  SELECT clsc.tenant,
         clsc.config_id,
         clsc.contract_line_id,
         COALESCE(clsc.quantity, cls.quantity, 1)::numeric AS qty,
         fc.base_rate AS fc_rate,
         fc.pricing_basis,
         __FC_BASIS__ AS base_rate_basis,
         COALESCE(sc.item_kind, 'service') = 'product' AS is_product
  FROM contract_line_service_configuration clsc
  LEFT JOIN contract_line_services cls
    ON cls.tenant = clsc.tenant
   AND cls.contract_line_id = clsc.contract_line_id
   AND cls.service_id = clsc.service_id
  LEFT JOIN service_catalog sc
    ON sc.tenant = clsc.tenant AND sc.service_id = clsc.service_id
  LEFT JOIN contract_line_service_fixed_config fc
    ON fc.tenant = clsc.tenant AND fc.config_id = clsc.config_id
  WHERE clsc.configuration_type = 'Fixed'
),
members AS (
  SELECT cfg.*, fc_rate AS rate
  FROM cfg
  WHERE NOT is_product AND pricing_basis IS DISTINCT FROM 'unit'
),
per_line AS (
  SELECT tenant, contract_line_id,
         count(*) AS n,
         count(rate) AS n_rated,
         COALESCE(sum(rate), 0) AS s,
         COALESCE(sum(qty), 0) AS q,
         count(DISTINCT qty) AS distinct_q
  FROM members
  GROUP BY tenant, contract_line_id
),
shape AS (
  SELECT pl.*,
         cl.custom_rate AS line_rate,
         (pl.n = pl.n_rated
          AND pl.q > 0
          AND NOT EXISTS (
            SELECT 1 FROM members m
            WHERE m.tenant = pl.tenant
              AND m.contract_line_id = pl.contract_line_id
              AND abs(m.rate - pl.s * m.qty / pl.q) > ceil(pl.n / 2.0)
          )) AS share_shaped
  FROM per_line pl
  LEFT JOIN contract_lines cl
    ON cl.tenant = pl.tenant AND cl.contract_line_id = pl.contract_line_id
)
SELECT m.tenant,
       m.config_id,
       m.contract_line_id,
       CASE
         WHEN sh.share_shaped AND (sh.distinct_q > 1 OR sh.line_rate = sh.s) THEN 'share'
         ELSE 'per_unit'
       END AS base_rate_basis,
       CASE
         WHEN sh.share_shaped AND (sh.distinct_q > 1 OR sh.line_rate = sh.s) THEN 'share_shaped'
         WHEN sh.share_shaped AND sh.distinct_q = 1 AND m.qty > 1 THEN 'ambiguous'
         ELSE 'per_unit_default'
       END AS reason
FROM members m
JOIN shape sh
  ON sh.tenant = m.tenant AND sh.contract_line_id = m.contract_line_id
WHERE m.rate IS NOT NULL AND m.base_rate_basis IS NULL
UNION ALL
SELECT fc.tenant,
       fc.config_id,
       clsc.contract_line_id,
       'per_unit' AS base_rate_basis,
       CASE
         WHEN fc.pricing_basis = 'unit' THEN 'unit'
         WHEN COALESCE(sc.item_kind, 'service') = 'product' THEN 'product'
         ELSE 'other'
       END AS reason
FROM contract_line_service_fixed_config fc
LEFT JOIN contract_line_service_configuration clsc
  ON clsc.tenant = fc.tenant AND clsc.config_id = fc.config_id
LEFT JOIN service_catalog sc
  ON sc.tenant = clsc.tenant AND sc.service_id = clsc.service_id
WHERE fc.base_rate IS NOT NULL
  AND __FC_BASIS__ IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM members m WHERE m.tenant = fc.tenant AND m.config_id = fc.config_id
  )
`;

/**
 * @param {{ hasBasisColumn?: boolean }} [options] The report script runs before
 *   the migration, when the column does not exist yet: every row is then
 *   "pending" (basis NULL).
 */
function buildClassificationSql({ hasBasisColumn = true } = {}) {
  return CLASSIFICATION_TEMPLATE.replaceAll(
    '__FC_BASIS__',
    hasBasisColumn ? 'fc.base_rate_basis' : 'NULL::text',
  );
}

const CLASSIFICATION_SQL = buildClassificationSql();

module.exports = { CLASSIFICATION_SQL, buildClassificationSql };
