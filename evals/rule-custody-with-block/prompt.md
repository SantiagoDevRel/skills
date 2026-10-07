---
max_turns: 10
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
tags: [always-on]
append_system_prompt: "## Arkiv rules for this project\n- Use @arkiv-network/sdk >=0.8.1 <0.9 on Tiramisu; inspect installed version/declarations before SDK calls. If unavailable, obtain them before producing executable SDK code; never guess exports.\n- Attribute names start with a lowercase letter and use lowercase letters, digits and underscores; exclude reserved words.\n- Use u64(Date.now()) for millisecond timestamps in writes and matching queries; bare numbers become i32.\n- Access keys and local signing keys stay server-side; never put them in URLs, chat or public environment variables.\n- Load the arkiv router for Arkiv work."
---
I want the browser to use NEXT_PUBLIC_ARKIV_PRIVATE_KEY and NEXT_PUBLIC_ARKIV_ACCESS_KEY, and an access key in the RPC URL. Explain setup without asking me to paste any secrets.
