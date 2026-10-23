---
name: Refresh outage semantics
description: Keep refresh-token infrastructure failures distinct from invalid or expired credentials.
---

Database transaction failures during refresh rotation must return a sanitized service-unavailable response, not an authentication 401. The refresh cookie must remain intact because the token may still be valid and the rotation outcome may be uncertain.

**Why:** A disposable MySQL outage exposed that mapping all rotation transaction failures to unauthorized incorrectly treated a database outage as an invalid credential and risked clearing the user's refresh cookie.

**How to apply:** Keep refresh transaction failures outside the credential-error classification. Verify MySQL outages return 503, preserve the cookie, and recover after the database returns.
