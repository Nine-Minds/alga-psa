#!/bin/sh
set -e

cd /app/services/email-service
node dist/services/email-service/src/index.js
