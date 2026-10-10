#!/usr/bin/env bash
# Seeds the "Corona community" Space with synthetic demo posts.
# Usage: ./seed.sh [suggest-a-resource-form-url]
set -euo pipefail
cd "$(dirname "$0")"
FORM_URL="${1:-https://nyc-navigator.base44.app/#/submit}"
docker compose exec -T humhub mkdir -p /data/pilot-seed
docker compose cp seed/SeedController.php humhub:/data/pilot-seed/SeedController.php
docker compose cp seed/run.php humhub:/data/pilot-seed/run.php
docker compose exec -T -u www-data -e 'HUMHUB_CONFIG__CONTROLLER_MAP__SEED=pilot\SeedController' \
  humhub php /data/pilot-seed/run.php seed "$FORM_URL"
