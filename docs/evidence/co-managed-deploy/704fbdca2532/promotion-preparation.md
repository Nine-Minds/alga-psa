# Canonical review promotion preparation

Current canonical `review-app`: port 23374, source `cd28aa9531f7bd465711f90b92bf8592185d9c77`, build `build-1792904848073`.

Verified candidate: port 23377, source `704fbdca25327d9bfc1b53d37771e05a4de3ca08`, build `build-1792910542349`, dist `server/.next-review-smoke-704f`.

The documented supported lifecycle is conclude then ensure:

```sh
PROJECT=964ce5e0-45a5-41b2-8e2c-73903742a85a
WORKTREE=/home/robert/alga-copies/feature-co-managed-it
RUN="$WORKTREE/scripts/dev/run-card-service.sh"
alga-dev workflow-conclude-service --projectId=$PROJECT --name=review-app --reason="Replace cd28 review target with verified 704f candidate"
alga-dev workflow-ensure-service --projectId=$PROJECT --name=review-app \
  --cwd="$WORKTREE/server" \
  --readinessPort=23374 --readinessPath=/api/health \
  --command="$RUN review-app --health http://127.0.0.1:23374/api/health \
    env NEXTAUTH_URL=http://feature-co-managed-it.localhost:23374 APPLICATION_URL=http://feature-co-managed-it.localhost:23374 HOST=http://feature-co-managed-it.localhost:23374 NM_STORE_URL=http://feature-co-managed-it.localhost:23374 NEXT_DIST_DIR=.next-review-smoke-704f NODE_ENV=production PORT=23374 npx next start -p 23374 -H 0.0.0.0"
```

Prepared but not executed: `workflow-ensure-service` starts a second app process on 23374, prohibited by the current no-start constraint. The older target remains running. Registration state alone is not readiness. `workflow-open-review` was invoked and returned `Browser backend disposed`; candidate QA entry through that operation remains unverified.
