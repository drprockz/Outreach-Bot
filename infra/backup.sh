#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-/home/radar/db/radar.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/home/radar/backups}"
DATE=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"

# Use SQLite .backup for a consistent snapshot (safe with WAL mode)
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/radar-$DATE.sqlite'"

# Upload to Backblaze B2 if rclone is available
if command -v rclone &> /dev/null; then
  rclone copy "$BACKUP_DIR/radar-$DATE.sqlite" b2:radar-backups/
fi

# Clean up backups older than 30 days
find "$BACKUP_DIR" -name "radar-*.sqlite" -mtime +30 -delete

echo "Backup complete: radar-$DATE.sqlite"
