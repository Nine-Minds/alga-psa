# Portal Custom Domain Runbook

_Last updated: 2025-09-19_

## Purpose
Operational checklist for supporting enterprise tenants that register branded client-portal domains.

## Prerequisites
- Access to the production Temporal namespace and task queue (`portal-domain-workflows`).
- `kubectl` context configured for the hosting cluster.
- Ability to query the `portal_domains` table (admin connection).

## Registration Flow Overview
1. Tenant submits a vanity domain from Settings → Client Portal.
2. Server action validates the domain, stores it in `portal_domains`, and enqueues the Temporal workflow.
3. Workflow stages:
   - `verifying_dns`: lookup confirms the CNAME points to `<tenant7>.portal.algapsa.com`.
   - `pending_certificate`: reconciliation renders Kubernetes manifests, writes JSON snapshots (if `PORTAL_DOMAIN_MANIFEST_DIR` is set), and applies resources.
   - `deploying`: resources applied; waiting on cert-manager and Istio to finish.
   - `active`: once certificate readiness + HTTP probe succeed (polling to be implemented).
4. Any failure bubbles `status` + `status_message` back to the UI for tenant remediation.

## Common Tasks
### Check Current Status
```sql
select tenant, domain, status, status_message, last_checked_at
from portal_domains
where tenant = '<tenant-uuid>';
```

### Force Reconciliation
```bash
# queue Temporal signal to rerun reconciliation
node scripts/trigger-portal-domain-workflow.mjs --tenant <tenant-uuid> --domain-id <portal-domain-id>
```
_(Script placeholder – use Temporal CLI if script not yet available)_

If `PORTAL_DOMAIN_MANIFEST_DIR` is configured, inspect the generated manifests prior to committing them to nm-kube-config:

```bash
ls $PORTAL_DOMAIN_MANIFEST_DIR/<tenant-prefix>
cat $PORTAL_DOMAIN_MANIFEST_DIR/<tenant-prefix>/gateway.json
```

### Inspect Kubernetes Artifacts
```
kubectl get certificate portal-domain-<tenant7> -n msp
kubectl get gateway portal-domain-gw-<tenant7> -n istio-system
kubectl get virtualservice portal-domain-vs-<tenant7> -n msp
```

If HTTP-01 routing is enabled, confirm the challenge service resolves:

```
kubectl get service -n msp ${PORTAL_DOMAIN_CHALLENGE_HOST%%.*}
```

### Clean Up After Disable
Workflow sets the row to `disabled` and re-enqueues reconciliation. If resources linger:
```
kubectl delete certificate <name> -n msp
kubectl delete secret <name> -n msp
kubectl delete virtualservice <name> -n msp
```

## Alerts & Observability
- Review the JSON manifests at `$PORTAL_DOMAIN_MANIFEST_DIR`, commit them to the `nm-kube-config` worktree, and open a PR before or immediately after applying changes.
- Temporal workflow logs emit OpenTelemetry spans tagged with `tenantId` and `portalDomainId`.
- PostHog events:
  - `portal_domain.registration_enqueued`
  - `portal_domain.refresh`
  - `portal_domain.disable`
Review dashboard “Portal Domains – Provisioning” for activation/ failure trends.

## Troubleshooting
| Symptom | Likely Cause | Mitigation |
| --- | --- | --- |
| Status stuck `dns_failed` | CNAME not pointing to canonical host | Ask tenant to update DNS or reduce TTL; use `dig` to confirm. |
| Status `certificate_failed` | Reconciliation unable to apply resources | Check Temporal worker logs; validate cert-manager/Ingress configuration. |
| Workflow not enqueued | Temporal unavailable or misconfigured task queue | Confirm Temporal connectivity; redeploy worker if necessary. |

## Open Follow-ups
- Implement/standardise HTTP-01 challenge serving and readiness polling before marking domains `active`.
- Add alerting for certificates stuck in `False` state > 1 hour.
- Ship the Temporal signal CLI/script referenced above.
