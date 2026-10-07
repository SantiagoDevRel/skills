---
type: llm
weight: 1
---

Judge only the requested lifecycle behavior. A correct response must satisfy these criteria:

- Use changeOwnership({ entityKey, newOwner }) with owner authorization and a different nonzero address. The current owner changes to Bob while the creator remains Alice.
- After transfer, Bob may patch this mutable entity and Alice loses owner-only mutation, transfer and deletion rights. Transfer does not make readonly content mutable and does not change the creation flags.
- Read owner and creator after confirmation, with the confirmed transaction and later state distinguished. A later read can observe another transfer or fail after removal; such a read failure does not establish that the confirmed transfer failed or justify replay.
- The immutable creator identifies the creating wallet, not who authored the current rewritten payload. Creator/owner filters are not application authorization or proof of current content authorship. Do not invent a built-in authorship signature or an executed verification.

Fail a response that contradicts any required lifecycle behavior, invents an SDK API, or fabricates execution. Do not require optional architecture or exact prose.
