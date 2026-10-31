# Phase 63 — Docker Network Diagnosis

**Date:** 2026-10-31
**Result:** Bridge topology **FAIL**; loopback-only Docker host networking **PASS** for this disposable lab
**Scope:** Docker/network diagnostics and isolated synthetic-data tests only.

## Findings

| Area | Evidence | Conclusion |
|---|---|---|
| Docker daemon | Server 27.5.1; Docker reports Ubuntu 24.04.4 LTS (containerized), `overlay2`, 4 CPUs, and an 8 GiB memory limit. Security options reported `seccomp` and `cgroupns`. | The daemon is running inside a containerized environment rather than a bare host. |
| Address allocation | Default bridge: `172.17.0.0/16`. The diagnostic user-defined bridge allocated `172.18.0.0/16`; Phase 62 peer names resolved to their expected member IPs. | IP allocation and DNS resolution worked. |
| Bridge forwarding indicators | `ip_forward=1`; `bridge-nf-call-iptables=1`; `bridge-nf-call-ip6tables=1`. Default bridge reports ICC and masquerading enabled. | These settings alone do not prove data-plane connectivity. |
| Firewall visibility | `iptables`, `nft`, and `brctl` tools were not available in the workspace; daemon configuration file was not readable at the inspected path. | The exact firewall/outer-runtime rule could not be identified. |
| Bridge TCP | A temporary MongoDB 7.0.17 listener on a dedicated user-defined bridge resolved through Docker DNS, but a helper on that same bridge could not connect to its MongoDB port. Phase 62 independently observed peer TCP failures on both internal and non-internal user-defined bridges. | Bridge container-to-container TCP is unavailable in this environment. This is observed behavior; the specific enforcing firewall or nested-network rule remains unknown. |
| Docker-host loopback | A host-network helper connected to a MongoDB listener bound to `127.0.0.1`. During the lab, the workspace shell itself could not reach Docker-host loopback ports; a host-network helper could. | The Docker host has a separate network namespace from the workspace shell. A helper using the Docker host network is needed to test local listeners. |
| Public exposure | The successful cluster used Docker host networking, bound each MongoDB process to `127.0.0.1`, and published no Docker ports. | No public listener or published port was configured. Other processes sharing the Docker host network namespace could reach loopback; this topology is for disposable local testing only. |

## Root cause and working topology

The Phase 62 bridge failure was reproducible: DNS resolved member names but peer TCP connections failed. Available evidence does not identify the exact outer firewall or runtime restriction, so this report does not attribute the failure to a particular rule.

The successful local topology used the Phase 63-approved host-network candidate:

- Three MongoDB 7.0.17 processes shared the Docker host network namespace.
- Each bound only to IPv4 loopback, `127.0.0.1`, on a distinct port (45271–45273); there were no published Docker ports.
- The replica set advertised the exact reachable endpoints `127.0.0.1:45271`, `127.0.0.1:45272`, and `127.0.0.1:45273`. Numeric loopback endpoints required no Docker DNS.
- Each member used a separate Docker volume, test-only authentication, and the same internal keyfile.
- Members were started sequentially. The official image's initialization process temporarily used port 27017 before switching to each configured member port. Starting all three at once caused temporary bootstrap-listener collisions; sequential startup avoided them.

This is a loopback-only host-network test topology, not a dedicated private Docker bridge. It is not a production topology recommendation and does not establish application-host connectivity or production isolation.

## Candidate assessment

| Candidate | Result | Limitation |
|---|---|---|
| Dedicated Docker bridge with service DNS | **FAIL** | DNS worked, but TCP connections to MongoDB listeners did not. |
| Host networking with isolated loopback ports | **PASS for local lab** | Verified with distinct loopback ports and no published ports. All host-network processes share the Docker host network namespace; keep this limited to synthetic disposable tests. |
| Other local topology | **NOT RUN** | No additional topology was needed after the host-loopback option passed the required local checks. |

## Cleanup

All Phase 63 containers, volumes, temporary credentials, backup files, and diagnostic resources were removed. No Phase 63 bridge networks remained. A host-network helper verified ports 27017 and 45271–45274 were closed; workspace-local checks also found ports 45271–45274 closed. No unrelated Docker resources were removed.
