#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
# Credentials sourced from ~/.pgpass (chmod 600) — NOT .env, because
# this script runs under shell cron outside PM2's env.
# ~/.pgpass format: hostname:port:database:username:password
pg_dump \
  -h 127.0.0.1 -U radar -d radar \
  --format=custom --compress=9 \
  | rclone rcat "b2:radar-backups/radar-${TS}.dump"
