---
name: Swagger DTO metadata
description: Stable OpenAPI metadata patterns for primitive properties and nested DTO class ordering.
---

For Swagger DTO fields with primitive TypeScript types, declare `type: String` or `type: Number` explicitly in the `@ApiProperty` decorator instead of relying only on reflected type metadata.

**Why:** OpenAPI generation under the test runtime reported circular type references for primitive fields until their decorator metadata declared the types explicitly.

**How to apply:** Add explicit primitive `type` options to request, response, and list DTO decorators, then include `SwaggerModule.createDocument` in focused tests for documented routes.

Declare nested decorated DTO classes before wrapper classes that use them as property types. With decorator metadata enabled, TypeScript may emit an eager `design:type` reference that throws during CommonJS module initialization even when `@ApiProperty` uses a lazy type callback.

**Why:** A compiled Nest build failed with a temporal-dead-zone `ReferenceError` for a later-declared nested DTO; the focused test runtime did not expose the same initialization failure.

**How to apply:** Order nested classes before wrapper DTOs and smoke-test the compiled application after OpenAPI metadata changes.
