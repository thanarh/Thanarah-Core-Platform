#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" != "" && "${1:-}" != "--browser-fixture" ]]; then
  echo "Usage: $0 [--browser-fixture]" >&2; exit 1
fi
ports=(45271 45272 45273)
run_id="company-$(date +%s)-$$"
created=()
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for name in "${created[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for port in "${ports[@]}"; do
  if bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    echo "Refusing occupied disposable test port ${port}." >&2; exit 1
  fi
done
docker image inspect mongo:7.0.17 >/dev/null
for index in "${!ports[@]}"; do
  name="thanarah-${run_id}-${index}"
  docker run --detach --rm --name "$name" --network host mongo:7.0.17 \
    mongod --replSet rs0 --bind_ip 127.0.0.1 --port "${ports[$index]}" >/dev/null
  created+=("$name")
  ready=0
  for _ in $(seq 1 60); do
    if bash -c "exec 3<>/dev/tcp/127.0.0.1/${ports[$index]}" >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || exit 1
done
node <<'NODE'
const {MongoClient}=require('mongodb');
(async()=>{
 const c=new MongoClient('mongodb://127.0.0.1:45271/?directConnection=true');
 try {await c.connect();await c.db('admin').command({replSetInitiate:{_id:'rs0',members:[45271,45272,45273].map((p,_id)=>({_id,host:'127.0.0.1:'+p}))}});
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){const s=await c.db('admin').command({replSetGetStatus:1});if(s.members.filter(m=>m.stateStr==='PRIMARY').length===1&&s.members.filter(m=>m.stateStr==='SECONDARY').length===2)return;await new Promise(r=>setTimeout(r,500));}
 throw new Error('Replica set did not elect all members');
 } finally {await c.close();}
})().catch(()=>{console.error('Disposable replica-set initialization failed');process.exitCode=1;});
NODE
if [[ "${1:-}" == "--browser-fixture" ]]; then
  node scripts/company-browser-fixture.cjs &
  fixture_pid=$!
  trap 'kill -TERM "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true' TERM INT
  wait "$fixture_pid"
  exit $?
fi
if [[ "${CUSTOMER_TEST_ONLY:-}" == "1" ]]; then
  CUSTOMER_TEST_MONGO_URI='mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true' \
    npx vitest run test/customer-journey.integration.spec.ts --reporter=verbose
else
  COMPANY_TEST_MONGO_URI='mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true' \
    npx vitest run test/company-calculation.spec.ts test/company-operations.integration.spec.ts --reporter=verbose
fi
