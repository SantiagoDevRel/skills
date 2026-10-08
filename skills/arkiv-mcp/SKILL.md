---
name: arkiv-mcp
description: Use an already connected Arkiv MCP for source discovery, optional public-evidence verification and event preparation. Explain tools versus skills and diagnose missing capabilities or stale profiles. Use for Arkiv MCP questions; entity writes belong to SDK skills and this skill does not install or configure a plugin.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: "tiramisu"
  verified: "2026-10-08"
---

# Arkiv MCP

A skill is guidance the agent reads. A tool is a callable operation that returns data. The reviewed Arkiv gateway supplies knowledge and, in selected profiles, narrow public-evidence checks; it does not sign or submit chain transactions. Knowledge/model requests also send their arguments to the service. Optional feedback requires separate sharing consent.

Use this skill for an **existing authorized connection**. If the user chooses skills/SDK only, honor that choice. Use `arkiv-first-write`, `arkiv-query` and `arkiv-troubleshooting` directly; an MCP is not a prerequisite.

## Discover the actual profile

The gateway is [mcp.arkiv.network](https://mcp.arkiv.network/). Event paths are separate profiles, not arbitrary query parameters. Do not install a connector, edit host configuration or switch profiles merely because a tool is missing. Ask for the intended profile when that choice changes the task.

1. Inspect the tools and prompts exposed by the already connected host, or the protocol's `tools/list` and `prompts/list` through that connection. Use the current names and input schemas; hosts add different tool-name prefixes.
2. Read `server_status` if available: profile, release/configuration and event source revision. Read `network_status` for its checked SDK and network details, distinguishing live observations from dated catalog data.
3. Choose the narrow capability that answers the question. Argument-free `server_status`, `network_status`, `list_skills` and `list_knowledge`, when exposed, avoid sending task text during discovery; these are still network requests. Do not send a private schema, logs, keys or source code to learn whether a tool exists.
4. Compare returned version/source dates with the project's installed SDK. Neither an available tool nor fetched skill text proves an example works.

A GET response, HTTP 405 or an old connector catalog is not a Streamable HTTP protocol test. See [protocol preflight](references/protocol-preflight.md) for an explicitly authorized direct HTTP check without installing or changing a connector. Report which connection and operation failed. If discovery is unavailable, use the local SDK/docs instead of inventing tool availability.

## Match tools to the task

| Need | Capability, if exposed | Skill to read |
| --- | --- | --- |
| Network/version context | `server_status`, `network_status` | `arkiv` |
| Primary knowledge/package documentation | `list_knowledge`, `search_knowledge`, `read_knowledge`, `list_packages`, `get_package` | Relevant core or library skill; minimize submitted search text |
| Served skill text | `list_skills`, `get_skill` | Use the locally installed task skill if missing, `recommended: false`, execution-incompatible or pinned older; record the served revision |
| Local workflow guidance | `get_workflow`, workflow prompts such as `start`, `model_entities`, `diagnose_query`, `apply_skill` | `arkiv-first-write`, `arkiv-query`, or the selected task skill; returned guidance does not execute writes |
| Entity/transaction public observation | `verify_entity`, `verify_tx` | `arkiv-query` for reads, `arkiv-write-safety` for receipts, `arkiv-entity-expiration` for absence, `arkiv-troubleshooting` |
| Model or event preparation | `generate_entity_model`, `design_entity_model`, `check_schema`, `check_submission` | `arkiv-data-modeling`, `arkiv-security-trust` |
| Optional minimized feedback/outcome | `submit_feedback`, `report_outcome` | `arkiv-feedback` |

`prepare_feedback` is a **prompt**, not a tool. Hosts without prompt support can use `get_workflow` with `{ "name": "prepare_feedback" }` if the current schema supports it. Prompt and workflow content guides local work; fetching it does not submit an issue or application. Discover arguments before use. No fixed tool counts or generic health badge establish current capability.

The retained root-profile capture exposed no `verify_*`, `check_*` or `design_entity_model` tools; selected event profiles differed. For a missing verifier, inspect the receipt directly using [write safety](../arkiv-write-safety/SKILL.md) and read the entity with the SDK. Do not change profiles to obtain a tool without authorization.

## Read the evidence boundary

- `network_status` checks the RPC chain ID live in the reviewed service; other onboarding/service entries are dated catalog observations. The same chain ID can survive a network reset. Recheck embedded transaction hashes, entity keys and reported blocks against the current RPC before citing them as current evidence. It does not test funding, a signing adapter or complete faucet/login flow.
- Knowledge/model tools do not run arbitrary entity queries. Use the local SDK/RPC for actual application reads. `verify_*`, when exposed, are narrowly bounded observations, not a substitute for selected payloads or a full application query.
- Public verification requires the tool's current acknowledgment fields and a reviewed public key/hash. Never submit secrets as identifiers. Inspect **status, observation, warnings and error together**. Entity absence does not prove expiration, deletion or nonexistence; a successful receipt does not certify a particular payload, finality, authorship or a working app.
- Schema/submission checks are shallow text/model checks. Clearing blockers does not certify security, protocol acceptance, event eligibility or judging results. Verify generated names, types and code locally against the installed SDK.
- A skill catalog may lag the repository or serve unchanged examples. Record its source revision and warnings; prefer the installed current task skill when the served entry is missing, deprecated or older. Updating the service catalog belongs to its owner after repository integration.

For event work, inspect `server_status.event` when present; otherwise read that profile's event guide. Check its current event sources, draft/frozen state and evidence checklist. Prompts such as `qualify`, `prepare_devfolio` or `pillar_fit` apply only if actually exposed. Preparing evidence is separate from submitting it. Do not borrow another event's dates, rules or profile capabilities.

## Writes and privacy

Writes happen in the developer's project through the SDK and authorized EOA, with a verified network, spending budget and read-back. A legacy service requesting a private key is not an acceptable signing path. Keep access/signing keys out of connection URLs, prompts, tools and logs.

Read-only tool annotations describe effects, not confidentiality or absence of telemetry. In the retained service descriptions, `search_knowledge` recorded minimized search text/categories and `generate_entity_model` recorded operation/status/counts while excluding schemas and derivatives from telemetry. Its schema argument still traveled to the service. Review current descriptions and privacy terms before sending caller text; incomplete annotations are not a safety signal. A request to send nothing to the service means use local skills/SDK without MCP calls.

`submit_feedback` and `report_outcome` require explicit consent for the minimized fields and `sharingApproved: true` under the reviewed schemas. A boolean asserts consent; it does not obtain it. Do not infer a user opinion from the agent's success or claim best-effort acknowledgment guarantees storage. Never upload a full report as optional feedback or silently substitute it for a GitHub issue.

## Worked diagnosis

Request: “My post is missing; this profile has no `verify_entity`.” Load `arkiv-troubleshooting` for the reported failure, `arkiv-query` for the read and [entity expiration](../arkiv-entity-expiration/SKILL.md) for the receipt/history procedure that distinguishes absence causes. Inspect installed SDK, chain, exact key, constructor types, lowercase attributes, creator/owner scope and Entity Expiration. Query locally with the SDK. Do not claim the missing tool means the network is down or add another integration automatically.

Request: “The event check passes; submit my app.” A text check is insufficient evidence. Read the actual event submission procedure and authorization scope; inspect the app and required evidence locally. A preparation prompt or optional feedback acknowledgment is not an application submission.

Sources: [Arkiv gateway](https://mcp.arkiv.network/), [official SDK](https://www.npmjs.com/package/@arkiv-network/sdk/v/0.8.1), [Arkiv documentation](https://docs.arkiv.network). Service-source review on 2026-10-05 and retained audit captures on 2026-10-07 are historical: root and `/ethrome` reported release `1.1.7` / config `2026-10-05.2`; `/devfolio` reported `1.1.10` / config `2026-10-07.2` / content `d47bd82dbbb4167a`. The 2026-10-08 verification date covers this documentation and protocol-source review, not a fresh service call. Discover the connected profile again before relying on those observations.
