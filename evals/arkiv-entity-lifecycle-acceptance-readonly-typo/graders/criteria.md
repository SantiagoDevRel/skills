---
type: llm
weight: 1
---

Judge only the requested lifecycle behavior. A correct response must satisfy these criteria:

- Readonly freezes payload and attributes even for the owner; patchEntity, unset, and changing the flags cannot fix this entity in place.
- Create a corrected replacement using createEntity with flags in the create input. It has a new entity key; verify the replacement and repoint application references using the old-to-new mapping. Do not imply the old key is preserved or that its flags can be toggled.
- Readonly still allows authorized extension, ownership transfer and deletion. Creating a correction does not authorize deleting the old entity; retain it unless its removal is explicitly authorized.
- Recreation has its own creator/creation provenance. No tool execution, mined receipt, RPC result or completed migration may be fabricated.

Fail a response that contradicts any required lifecycle behavior, invents an SDK API, or fabricates execution. Do not require optional architecture or exact prose.
