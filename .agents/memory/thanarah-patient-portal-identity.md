---
name: Thanarah patient portal identity
description: The approved identity check for patient access to clinic invoices.
---

Patient invoice access uses the signed-in Thanarah account email to find exactly one active patient record in the selected clinic, then verifies control of the phone already stored on that record with an OTP. Do not create a staff membership for patient access. A change to the record's email or phone revokes the account link.

**Why:** The user approved «مطابقة البريد ثم OTP» and wants invoice access tied to existing clinic contact data rather than a patient-supplied record identifier.

**How to apply:** Keep match responses generic, send the code only to the stored phone, require successful verification before showing invoices, and fail closed when safe OTP delivery is unavailable.
