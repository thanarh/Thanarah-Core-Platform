---
name: Nest guard test overrides
description: Avoid DI failures in isolated Nest tests that replace route guards.
---

When a test replaces a guard with `overrideGuard`, do not also list the original guard class in that test module's `providers`; the duplicate provider can still be instantiated and require its real dependencies. Keep the `overrideGuard` call and remove the redundant provider registration.

**Why:** A guard refactor to explicit interface injection caused overridden test guards to fail during module compilation because Nest still instantiated the explicitly registered original guard.

**How to apply:** In isolated HTTP tests, register dependencies for the replacement guard only. Let `overrideGuard` supply the route guard and avoid adding the real guard to `providers` unless the test is specifically exercising it.
