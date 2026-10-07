---
type: llm
weight: 1
---

Judge only the requested lifecycle behavior. A correct response must satisfy these criteria:

- Choose flags: { permissionlessExtension: true } when creating the entity. Creation flags are immutable; an existing entity with permissionlessExtension:false needs a replacement and reference remapping to change that policy.
- A non-owner may call extendEntity on a live permissionless entity, with entityKey and expires. Adding lifetime requires a later absolute deadline; ExpirationTime.atBlock(target) is appropriate when an absolute target is supplied. Do not treat added blocks as an absolute deadline or claim an equal target adds lifetime.
- This flag grants extension rights only. Mutable attributes/payload remain owner-only; readonly content cannot be patched by anyone. Transfers and deletion remain owner-only.
- Other parties can postpone an expiration the owner wanted. An expired entity cannot be revived by extending its old key; recreate and remap. Do not fabricate a transaction or promise expiration emits an event.

Fail a response that contradicts any required lifecycle behavior, invents an SDK API, or fabricates execution. Do not require optional architecture or exact prose.
