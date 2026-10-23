#!/bin/bash
# Usage: run-flow.sh <outfile> <jobName> [waitSeconds]
# Publishes one MAINTENANCE_JOB_REQUESTED for the fixture integration and reports
# the dev-server log delta, simulator hits, unacked stream entries and DB state.
set -u
ROOT=/home/robert/alga-copies/feature-alga0002047-skip-rmm-polling-jobs-for-ninjaone-i
T=dd8cb218-d46d-47f3-be27-8aa50aad5fce; I=268f437e-28ca-4c1a-8b57-bb5fe3f6df00
OUT=$1; JOB=$2; WAIT=${3:-20}
SID=$(alga-dev workflow-list-services --projectId=eafbbfc8-7ee0-4f4a-b181-c784bc899ab3 | python3 -c 'import sys,json;print([s["sessionId"] for s in json.load(sys.stdin)["services"] if s["name"]=="dev-server" and s["status"]=="live"][0])')
RP=$(cat $ROOT/secrets/redis_password)
STREAM="alga-psa-a2047:event-stream:global:MAINTENANCE_JOB_REQUESTED"
rcli() { docker exec alga-psa-local-test_redis redis-cli -a "$RP" --no-auth-warning "$@"; }
# Ack leftovers from earlier flows so each flow's pending count is its own.
for id in $(rcli xpending "$STREAM" event-processors - + 100 | awk 'NR%4==1'); do rcli xack "$STREAM" event-processors "$id" >/dev/null; done
curl -s -XPOST localhost:47731/control/reset >/dev/null
alga-dev terminal-get-history --sessionId=$SID > /tmp/a2047-before.txt
{
echo "=== FLOW $JOB  $(date -Is)  sim-mode=$(curl -s localhost:47731/control/requests | python3 -c 'import sys,json;print(json.load(sys.stdin)["mode"])')"
echo "--- DB before (sync_status|sync_error|tokenLifecycle.status):"; /tmp/a2047-psql.sh -Atc "select sync_status, coalesce(sync_error,'<null>'), coalesce(settings->'tokenLifecycle'->>'status','<none>') from rmm_integrations where integration_id='$I'"
echo "--- pending before publish: $(rcli xpending "$STREAM" event-processors | head -1)"
echo "--- publish:"; (cd $ROOT/tools/smoke-sim && REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_PASSWORD="$RP" REDIS_PREFIX=alga-psa-a2047: node publish-job.mjs $JOB $T $I 2>/dev/null | tail -1)
sleep $WAIT
alga-dev terminal-get-history --sessionId=$SID > /tmp/a2047-after.txt
echo "--- dev-server log delta (filtered):"
python3 - <<'EOF' | grep -aE "Rmm|MaintenanceJob|EventBus\] (Error|Received)|NinjaOne|reconnect|cycle|detectedDuring|message:|error:" | grep -av "Added handler" | cut -c1-400
b=open('/tmp/a2047-before.txt',errors='replace').read().splitlines()
a=open('/tmp/a2047-after.txt',errors='replace').read().splitlines()
tail=[l for l in b if l.strip()][-6:]
b=[l for l in b if l.strip()]; a=[l for l in a if l.strip()]
start=0
for i in range(len(a)-len(tail),-1,-1):
    if a[i:i+len(tail)]==tail: start=i+len(tail); break
print('\n'.join(a[start:]))
EOF
echo "--- ninjaone-sim requests:"; curl -s localhost:47731/control/requests; echo
echo "--- stream consumer-group pending (unacked) after: $(rcli xpending "$STREAM" event-processors | head -1)"
echo "--- DB after:"; /tmp/a2047-psql.sh -Atc "select sync_status, coalesce(sync_error,'<null>'), coalesce(settings->'tokenLifecycle'->>'status','<none>') from rmm_integrations where integration_id='$I'"
} 2>&1 | tee "$OUT"
