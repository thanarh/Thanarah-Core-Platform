#!/usr/bin/env bash
set -Eeuo pipefail
CUSTOMER_TEST_ONLY=1 exec bash scripts/test-company-operations.sh
