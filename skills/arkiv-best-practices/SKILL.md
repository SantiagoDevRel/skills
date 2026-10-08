---
name: arkiv-best-practices
description: Deprecated compatibility entrypoint for older Arkiv skill installations. For new Arkiv work, load the arkiv router directly; this stub only redirects to current SDK and Tiramisu guidance.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-08"
  deprecated: "true"
  replaced-by: "arkiv"
---

# Deprecated Arkiv entrypoint

Use [arkiv](../arkiv/SKILL.md) for current guidance and its focused skill index.

For older examples, use the router's [legacy-pattern corrections](../arkiv/references/known-issues.md#coming-from-older-skills).

If arkiv is not installed, read the [pinned router in the source repository](https://github.com/Arkiv-Network/skills/blob/4447d1d8e08ced1f1fd469d25bef22edb5bb4f1b/skills/arkiv/SKILL.md). Install the complete focused catalog before replacing the legacy entrypoint.
