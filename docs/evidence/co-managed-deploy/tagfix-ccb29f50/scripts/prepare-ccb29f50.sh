#!/usr/bin/env bash
CO_MANAGED_REVIEW_PREPARE_ONLY=1 PORT=23380 CO_MANAGED_REVIEW_DIST=.next-review-final-ccb29f50 bash /home/robert/alga-copies/feature-co-managed-it/scripts/dev/run-co-managed-review-app.sh
prepare_result=$?
printf '%s\n' "$prepare_result" > /tmp/alga-smoke-evidence/co-managed-it-tagfix-ccb29f50/build-result.txt
sleep 86400
