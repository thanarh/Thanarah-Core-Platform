---
name: Encoded brand image transparency
description: Palette conversion can discard alpha despite an intermediate image reporting transparency.
---

Check transparency after encoding and decoding a generated logo, not only in
the image conversion's intermediate buffer.

**Why:** Quantizing the supplied faint-alpha source and forcing PNG palette
color type produced an opaque green background even though the intermediate
image still reported alpha. Explicit PNG8 encoding preserved transparent
corners; retaining RGBA is another option when partial-alpha edges matter.

**How to apply:** When optimizing brand PNGs, inspect a decoded corner pixel,
the encoded transparency information, and the actual small on-page icon before
replacing all logo aliases. Do not treat an alpha-capable channel count alone
as proof of transparent output.
