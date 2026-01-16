#!/bin/sh
set -e

cd /app/services/imap-service
node dist/services/imap-service/src/index.js
