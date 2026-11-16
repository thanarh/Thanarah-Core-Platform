---
name: Saudi-riyal display symbol
description: Use the supplied official mark for visible Saudi-riyal amounts without changing the currency code.
---

Use the owner-supplied transparent Saudi-riyal symbol in visible monetary
displays instead of a written currency abbreviation. Preserve `SAR` as the
stored and transmitted ISO currency code. Screen-reader descriptions may still
name the currency.

**Why:** The user supplied the official mark and asked it to replace written
currency labels; existing settings and APIs depend on the ISO code.

**How to apply:** Reuse the supplied mark for all user-facing amount displays.
Do not modify amount storage, currency identifiers, or the asset's transparency.
