#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" != "" && "${1:-}" != "--runtime-only" ]]; then
  echo "Usage: $0 [--runtime-only]" >&2
  exit 1
fi

ports=(45271 45272 45273)
run_id="$(date +%s)_$$"
database_name="phase65_platform_${run_id}"
uri="mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true"
created=()
test_pid=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$test_pid" ]] && kill -0 "$test_pid" 2>/dev/null; then
    kill -TERM "$test_pid" 2>/dev/null || true
    wait "$test_pid" 2>/dev/null || true
  fi
  for name in "${created[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for port in "${ports[@]}"; do
  if bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    echo "Refusing to use occupied loopback port ${port}." >&2
    exit 1
  fi
done

if ! docker image inspect mongo:7.0.17 >/dev/null 2>&1; then
  echo "Required local image mongo:7.0.17 is not available; refusing an implicit image pull." >&2
  exit 1
fi

for index in "${!ports[@]}"; do
  port="${ports[$index]}"
  name="thanarah-phase65-${run_id}-${index}"
  docker run --detach --rm \
    --name "$name" \
    --label "thanarah.phase65.run=${run_id}" \
    --network host \
    mongo:7.0.17 \
    mongod --replSet rs0 --bind_ip 127.0.0.1 --port "$port" --setParameter enableTestCommands=1
  created+=("$name")

  ready=0
  for _ in $(seq 1 60); do
    if bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "MongoDB member on loopback port ${port} did not become reachable." >&2
    exit 1
  fi
done

if [[ "${1:-}" == "--runtime-only" ]]; then
PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/phase65-platform-mongodb.integration.spec.ts \
    -t 'provisions and verifies exact index keys/options including identity collation' --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""
else
PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/phase65-platform-mongodb.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""

PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/mongo-tenant-role-assignments.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""

PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/mongo-doctor-staff-scope.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""

PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/mongo-control-plane.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""

PHASE64_MONGO_URI="$uri" \
  npx vitest run test/phase64-mongodb-application.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""
fi

npm run build
PHASE65_PLATFORM_MONGO_URI="$uri" \
PHASE65_PLATFORM_MONGO_DATABASE="$database_name" \
  npx vitest run test/mongo-only-runtime.integration.spec.ts --reporter=verbose &
test_pid=$!
wait "$test_pid"
test_pid=""
