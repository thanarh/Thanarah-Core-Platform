---
name: Headless Chromium cleanup
description: Safely shut down Chromium and its helper processes before removing a disposable user-data directory.
---

On Linux, launch test-owned headless Chromium in a detached process group. Close its CDP session, send `SIGTERM` to the group, wait, then send `SIGKILL` to any remaining group members before recursively deleting the temporary profile.

**Why:** Killing only the Chromium parent can leave helper processes writing profile files; removing the profile during those writes can fail with `ENOTEMPTY` and mask the test's real result.

**How to apply:** Use this shutdown sequence in integration tests that create a temporary Chromium `--user-data-dir`. Keep the profile disposable and never reuse a user's browser profile.
