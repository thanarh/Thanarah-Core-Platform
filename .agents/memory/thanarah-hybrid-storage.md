---
name: Thanarah hybrid storage boundary
description: The product's standing division between central platform storage and tenant operational storage.
---

Keep MySQL/Prisma for platform identity, sessions, roles, tenants, subscriptions, and configuration. Use MongoDB for tenant medical and operational data, including patients, appointments, encounters, medical records, and catalogs. Do not remove Prisma/MySQL or pursue a full central-data migration as part of product completion.

**Why:** The user superseded the original all-Mongo migration goal with a hybrid architecture so central SaaS controls remain relational while tenant medical and operational records use MongoDB.

**How to apply:** Keep changes additive, maintain trusted tenant context and authorization across both adapters, and prove port parity before activating a Mongo candidate. Do not access production or migrate production data without explicit authorization.
