# Superseded live evidence: correction required

The denial claims in the earlier version of this report were incorrect. Those calls used canonical QA while four active restrictions denied the coarse `hasPermission` checks in `ticketResourceActions.ts`; they did not reach record-level authorization. The removed `denied-*` and `invalid-staffing-action-response.json` files captured those coarse denials and a malformed direct multipart attempt. Do not use them as evidence of the record-level fix or rollback.

The current, corrected live run is documented in [`security-authz-addticketresource-20261104-corrected-2115`](../security-authz-addticketresource-20261104-corrected-2115/report.md), tied to the exact tested revision in that directory. Canonical QA restrictions remained active during the corrected run.
