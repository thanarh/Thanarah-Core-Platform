---
name: Docker exec restrictions
description: Testcontainers Docker exec process launch can fail in this Replit workspace even when containers start normally.
---

When a Testcontainers `exec` call fails with OCI runtime/setns errors or a bare exit code 126, do not assume the in-container executable is missing. In this workspace, the Docker daemon could start disposable containers but could not reliably start exec processes inside them. For tests requiring native database tools, run a short-lived helper container with the tool as its startup command, connect through a mapped host port using `host.docker.internal` and `host-gateway`, and transfer files with container copy/archive APIs.

**Why:** MySQL backup/restore tooling was present in the image, but execution through Testcontainers `exec` failed before the command ran. A helper container on the Docker host-gateway path successfully completed the disposable restore test.

**How to apply:** First distinguish OCI execution failure from a command-level error. Avoid `withNetworkMode(container:...)` in this environment; use the mapped host port and Docker host-gateway when helper containers need to reach an existing disposable service.
