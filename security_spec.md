# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default Deny**: All paths not explicitly matched (`/teachers/{teacherId}` and `/classes/{classId}`) are unconditionally denied (`allow read, write: if false;`).
2. **PII Isolation on Teacher Profiles (`/teachers/{teacherId}`)**:
   - A teacher profile contains PII (`phone`, `fullName`) and may ONLY be read (`get`), created, updated, or deleted by the authenticated owner where `request.auth.uid == teacherId` and `request.auth.token.email_verified == true`.
   - `list` is strictly forbidden on `/teachers` to prevent PII scraping.
   - `ownerId` must equal `request.auth.uid` and `teacherId`, and `createdAt` and `ownerId` are immutable on update.
3. **Relational Integrity & Ownership on Classes (`/classes/{classId}`)**:
   - A `SchoolClass` document cannot be created unless the parent teacher document `/teachers/$(request.auth.uid)` exists (`exists(...)`) and `incoming().ownerId == request.auth.uid`.
   - `list` queries on `/classes` are strictly restricted via `resource.data.ownerId == request.auth.uid`.
   - Updates to `/classes/{classId}` use the Action-Based Update Pattern with `affectedKeys().hasOnly(...)`, preserve immutable fields (`ownerId`, `createdAt`), and enforce `incoming().updatedAt == request.time`.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Shadow Field Injection on Teacher Create)**: Includes `"isAdmin": true` in `/teachers/user_1`. Expected: `PERMISSION_DENIED`.
2. **Payload 2 (Identity Spoofing on Teacher Create)**: Authenticated as `user_1`, attempts to create `/teachers/user_2` with `ownerId: "user_2"`. Expected: `PERMISSION_DENIED`.
3. **Payload 3 (Unverified Email Token Attack)**: Authenticated as `user_1` with `email_verified: false`, attempts to write `/teachers/user_1`. Expected: `PERMISSION_DENIED`.
4. **Payload 4 (PII Cross-User Read)**: Authenticated as `user_2`, attempts `get` on `/teachers/user_1`. Expected: `PERMISSION_DENIED`.
5. **Payload 5 (Teacher Collection Enumeration)**: Authenticated as `user_1`, attempts `list` on `/teachers`. Expected: `PERMISSION_DENIED`.
6. **Payload 6 (Orphaned Class Creation)**: Authenticated as `user_no_profile`, attempts to create `/classes/class_1` when `/teachers/user_no_profile` does not exist. Expected: `PERMISSION_DENIED`.
7. **Payload 7 (Client Timestamp Forgery on Create)**: Attempts to create `/classes/class_1` with a past timestamp `createdAt != request.time`. Expected: `PERMISSION_DENIED`.
8. **Payload 8 (Immutable Field Mutation on Update)**: Attempts to change `ownerId` or `createdAt` during an update to `/classes/class_1`. Expected: `PERMISSION_DENIED`.
9. **Payload 9 (Value Poisoning on Update)**: Attempts to update `name` in `/classes/class_1` with a 5,000-character string exceeding `maxLength: 60`. Expected: `PERMISSION_DENIED`.
10. **Payload 10 (Invalid Enum Value on Ruling)**: Attempts to set `defaultRuling: "hexagonal-grid"` outside `['lined-slanted', 'lined-wide', 'squared-grid']`. Expected: `PERMISSION_DENIED`.
11. **Payload 11 (Unauthorized Cross-Teacher Class List)**: Authenticated as `user_2`, attempts to list `/classes` owned by `user_1`. Expected: `PERMISSION_DENIED`.
12. **Payload 12 (ID Poisoning Attack)**: Attempts to create `/classes/invalid id with spaces!@#` violating `^[a-zA-Z0-9_\-]+$`. Expected: `PERMISSION_DENIED`.
