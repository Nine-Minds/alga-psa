# Workflow action replay storage rollout

New action invocations store redacted diagnostics in `output_json` and the original retry result in `replay_output_encrypted`. History and exports omit the private field. The current redaction rule masks secret references; this is not a general guarantee that arbitrary action outputs contain no sensitive data.

## Deployment order

1. Apply `20260907210000_add_workflow_action_replay_output.cjs` before starting upgraded workers. The activity checks for the column before invoking a handler.
2. Make the replay key configuration available to every upgraded worker. The existing mandatory `nextauth_secret` / `NEXTAUTH_SECRET` supplies the default key. Missing or malformed configuration rejects new action execution before any handler effect.
3. Drain and stop older workers before upgraded workers begin processing this task queue. Older workers read `output_json` directly and cannot replay newly protected results correctly. This change does not implement a mixed-version protocol; do not run both versions against the queue during cutover.
4. Start upgraded workers and validate action execution, retry deduplication, redacted history/export responses and key availability. A completed legacy invocation with no encrypted field still replays its original `output_json` without invoking its handler.

The storage and application tests verify migration/preflight behavior, but an actual deployment/drain rehearsal remains required before claiming rollout validation. Historical plaintext invocation outputs are not bulk rewritten by this migration.

## Key rotation

An explicit `workflow_replay_keys` secret (environment fallback `WORKFLOW_REPLAY_KEYS`) accepts this shape, with values supplied through the deployment's secret provider:

```json
{
  "activeKeyId": "current",
  "keys": {
    "nextauth": "<original fallback secret>",
    "current": "<new independently generated secret>"
  }
}
```

All workers must receive the complete ring. New writes use `activeKeyId`; retries select the recorded key ID. When moving from the default key to an explicit ring, retain the original fallback value under `nextauth`. Retain every previous key while any invocation encrypted under it can still be retried. Removing a needed key causes a retry to fail without re-running the handler.

Do not rotate the fallback NextAuth secret without first retaining the old value in an explicit ring. Key values must never be placed in logs, plan evidence or committed configuration.

## Rollback

The migration refuses to remove the column while encrypted replay results exist. Do not clear protected results merely to permit rollback: that loses successful-action retry state. A return to older workers requires a separately validated data/worker compatibility procedure; it is not supported by simply rolling back the image.
