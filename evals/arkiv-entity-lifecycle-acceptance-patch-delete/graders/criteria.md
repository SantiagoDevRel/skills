---
type: llm
weight: 1
---

Judge only the requested lifecycle behavior. A correct response must satisfy these criteria:

- executeBatch has a fixed SDK order independent of JavaScript property order: creates, patches, deletes, extensions, ownership changes. The patch on this key runs before its deletion.
- When both operations succeed, the entity is deleted from live state; the patch does not run after deletion and does not leave a live patched entity. Deletion does not erase prior calldata or copies already read.
- The batch is atomic. An invalid patch makes the batch fail, so that batch does not delete the entity or apply a successful partial patch. Do not recommend reordering object properties to bypass validation or readonly/owner checks.
- Use SDK executeBatch with patches and deletes arrays rather than an EVM contract ABI workaround. No send, estimate, receipt or successful deletion may be fabricated.

Fail a response that contradicts any required lifecycle behavior, invents an SDK API, or fabricates execution. Do not require optional architecture or exact prose.
