---
name: Swagger DTO metadata
description: A stable OpenAPI metadata pattern for primitive DTO properties.
---

For Swagger DTO fields with primitive TypeScript types, declare `type: String` or `type: Number` explicitly in the `@ApiProperty` decorator instead of relying only on reflected type metadata.

**Why:** OpenAPI generation under the test runtime reported circular type references for primitive fields until their decorator metadata declared the types explicitly.

**How to apply:** Add explicit primitive `type` options to request, response, and list DTO decorators, then include `SwaggerModule.createDocument` in focused tests for documented routes.
