#!/usr/bin/env bash
set -euo pipefail

if [[ "${NODE_ENV:-}" != "development" ]]; then
  echo "Blocked: set NODE_ENV=development for this development-only command." >&2
  exit 1
fi

if [[ -z "${PLATFORM_MONGO_URI:-}" || -z "${PLATFORM_MONGO_DATABASE:-}" ]]; then
  echo "Blocked: platform MongoDB is not configured." >&2
  exit 1
fi

read -r -p "Type CREATE DEV SUPER_ADMIN to continue: " confirmation
if [[ "$confirmation" != "CREATE DEV SUPER_ADMIN" ]]; then
  echo "Cancelled."
  exit 1
fi

read -r -s -p "New password (hidden): " password
echo
read -r -s -p "Confirm password (hidden): " password_confirmation
echo

if [[ "$password" != "$password_confirmation" ]]; then
  unset password password_confirmation
  echo "Passwords did not match." >&2
  exit 1
fi

if (( ${#password} < 14 )); then
  unset password password_confirmation
  echo "Use a password with at least 14 characters." >&2
  exit 1
fi

if [[ "$password" == *$'\n'* || "$password" == *$'\r'* ]]; then
  unset password password_confirmation
  echo "Password cannot contain line breaks." >&2
  exit 1
fi

trap 'unset password password_confirmation' EXIT
BOOTSTRAP_PASSWORD="$password" node scripts/bootstrap-platform-admin-dev.cjs
