---
max_turns: 10
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
tags: [always-on]
append_system_prompt: "## Arkiv rules for this project\n- Use @arkiv-network/sdk >=0.8.1 <0.9 on Tiramisu; inspect installed version/declarations before SDK calls. If unavailable, obtain them before producing executable SDK code; never guess exports.\n- Attribute names start with a lowercase letter and use lowercase letters, digits and underscores; exclude reserved words.\n- Use u64(Date.now()) for millisecond timestamps in writes and matching queries; bare numbers become i32.\n- Access keys and local signing keys stay server-side; never put them in URLs, chat or public environment variables.\n- Load the arkiv router for Arkiv work."
---
For an Arkiv write and matching query, store created_at: Date.now(). Show a safe exact typed value on both sides. No live operations.

Verified evaluation inputs: the project uses SDK 0.8.1. Its published declarations export u64 from @arkiv-network/sdk/attr, and eq and gte from @arkiv-network/sdk/query. Use these supplied declarations without claiming you inspected a missing installation.
