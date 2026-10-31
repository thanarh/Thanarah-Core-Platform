---
name: MongoDB local test networking
description: Local Docker topology constraints and startup ordering for disposable MongoDB replica-set labs in this workspace.
---

In this workspace's containerized Docker daemon, user-defined bridge DNS may resolve correctly while container-to-container TCP remains blocked. A disposable three-member MongoDB lab was able to run on Docker host networking when each `mongod` bound only to `127.0.0.1`, used a distinct port, and published no ports. This shares the Docker host network namespace and is suitable only for synthetic local testing, not a production topology.

The official MongoDB image's first-run initialization process temporarily binds port 27017 even when the final `mongod` uses a custom port. Starting multiple host-network members concurrently can collide on that temporary listener. Start members one at a time and wait for each configured final port before starting the next.

**Why:** Bridge peer TCP failed despite successful DNS resolution; simultaneous host-network startup produced address-in-use errors, while sequential startup on loopback ports formed a working replica set.

**How to apply:** Before any database test, verify the exact topology's peer TCP path. In host-network labs, bind only loopback, use unique member ports, start sequentially, and keep the topology disposable and synthetic-data-only. Never infer production suitability from this local workaround.
