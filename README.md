# Arkiv skills

Agent skills for working with [Arkiv](https://arkiv.network) — the Web3 database, powered by $GLM. Each skill is framework-neutral and follows the [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) spec, so it runs in Claude Code, Cursor, Cline, Aider, and any other compatible runtime.

## Available skills

| Skill | What it does |
| --- | --- |
| [`arkiv`](skills/arkiv/SKILL.md) | Routes Arkiv tasks to the appropriate focused skill. |
| [`arkiv-first-write`](skills/arkiv-first-write/SKILL.md) | Sets up Tiramisu and verifies a first entity and read-back. |
| [`arkiv-data-modeling`](skills/arkiv-data-modeling/SKILL.md) | Designs attributes, payloads, relations, and schema mappings. |
| [`arkiv-query`](skills/arkiv-query/SKILL.md) | Builds typed queries, pinned pagination, counts, and historical reads. |
| [`arkiv-entity-lifecycle`](skills/arkiv-entity-lifecycle/SKILL.md) | Explains flags, patching, ownership, deletion, and backup/restore. |
| [`arkiv-entity-expiration`](skills/arkiv-entity-expiration/SKILL.md) | Chooses expiration deadlines and reconciles Lifetime Extension. |
| [`arkiv-write-safety`](skills/arkiv-write-safety/SKILL.md) | Serializes bounded batches and reconciles uncertain transaction outcomes. |
| [`arkiv-app-integration`](skills/arkiv-app-integration/SKILL.md) | Connects browser wallets, authenticated server routes, DTOs, and events. |
| [`arkiv-security-trust`](skills/arkiv-security-trust/SKILL.md) | Defines public-data, publisher, signer, and authorization boundaries. |
| [`arkiv-troubleshooting`](skills/arkiv-troubleshooting/SKILL.md) | Diagnoses exact errors, missing results, and stale reads. |
| [`arkiv-encryption`](skills/arkiv-encryption/SKILL.md) | Encrypts payloads and explains key custody and remaining metadata exposure. |
| [`arkiv-large-files`](skills/arkiv-large-files/SKILL.md) | Stores and verifies chunks/images with SDK 0.8.1 releases; plans hybrid pointers and recovery. |
| [`arkiv-social-graph`](skills/arkiv-social-graph/SKILL.md) | Models relationships and scopes arkiv-graph visualization. |
| [`arkiv-indexing`](skills/arkiv-indexing/SKILL.md) | Builds Arkiv-to-app projections and explains the separate EVM-to-Arkiv sync package. |
| [`arkiv-feedback`](skills/arkiv-feedback/SKILL.md) | Prepares sanitized bug/feature reports and submits only with authorization. |
| [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md) | Documents read-only profiles and tool/schema checks for an existing connection. |
| [`arkiv-best-practices`](skills/arkiv-best-practices/SKILL.md) | Deprecated compatibility entrypoint; start with arkiv. |

The library guides cover published `arkiv-chunking@0.1.1`, `arkiv-images@0.1.2`, `arkiv-sync@0.3.0` and `create-arkiv-sync@0.3.0`, verified with SDK 0.8.1. Read their installed agent guides and the relevant skill for configuration, tested scope and recovery limits.

## Installation

<!-- arkiv-install:start -->

### Full plugin

The plugin bundles the skills, an MCP connection, and project guidance. It does not install the Arkiv SDK or fund a wallet. Use `arkiv-first-write` to set up the SDK and verify a first entity.

**Claude Code**

```bash
claude plugin marketplace add Arkiv-Network/skills
claude plugin install arkiv@arkiv
```

Restart the session. The SessionStart hook adds the rules when the project package.json declares @arkiv-network/sdk. Skills are namespaced: start with `arkiv:arkiv`.

**Codex**

```bash
codex plugin marketplace add Arkiv-Network/skills
codex plugin add arkiv@arkiv
```

Restart Codex and load `arkiv` for an Arkiv task. Review the plugin hooks before trusting them; installation alone does not enable untrusted hooks. Until then, ask your agent to append the [project rules](templates/AGENTS.snippet.md) to your project AGENTS.md while preserving its existing guidance.

**Cursor**

Copy this repository into a new folder at `~/.cursor/plugins/local/arkiv`, then restart Cursor or run Developer: Reload Window. In Customize, confirm the skills, the MCP connection, and the Arkiv rule. The plugin supplies an always-apply rule. External symlinks are skipped; organization policy can block local imports.

A Cursor marketplace install requires a reviewed listing. See the [official local installation instructions](https://cursor.com/docs/plugins#test-plugins-locally).

### Individual skills

Use this route for skills without the plugin. Start with the router; replace its name to install another skill from the index above.

```bash
# npm
npx skills add Arkiv-Network/skills --skill arkiv

# pnpm
pnpm dlx skills add Arkiv-Network/skills --skill arkiv
```

The default scope is the current project. Add `--global` for your user account. Check `npx skills --help` for host selection. Maintainers can use `--all` to install every skill into every supported agent without prompts; use the selected-skill route for a focused install.

### MCP only

Endpoint: [https://mcp.arkiv.network/](https://mcp.arkiv.network/). This connects source discovery and available profile tools; it does not install local skills or project rules. It never signs entity transactions. Optional feedback tools require consent before sharing data.

```bash
# Claude Code: personal connection available across projects
claude mcp add --transport http --scope user arkiv https://mcp.arkiv.network/

# Codex: personal connection
codex mcp add arkiv --url https://mcp.arkiv.network/
```

For Cursor, add this server through its MCP settings:

```json
{
  "mcpServers": {
    "arkiv": {
      "url": "https://mcp.arkiv.network/"
    }
  }
}
```

When using the full plugin, use its bundled connection instead of adding a second copy. Host approval and authentication policies still apply.

### Install prompt for other agents

Paste this into your agent and review the proposed host configuration and project-rule edits:

> Install the Arkiv skills from https://github.com/Arkiv-Network/skills, starting with arkiv. If I choose MCP tools, configure https://mcp.arkiv.network/ using this host's supported MCP format. Read templates/AGENTS.snippet.md from that repository and propose appending its Arkiv rules to my project AGENTS.md, preserving existing instructions. Ask before changing host settings or that file. Load the arkiv router for Arkiv tasks. Keep credentials out of source code, URLs and chat.

### Verification and maintenance

This release targets SDK >=0.8.1 <0.9 and Tiramisu (chain ID 7738577). Skills declare their checked SDK range, network, and date. These declarations do not certify a completed funded test or current service health.

Installation files come from `plugin.config.json` and `source/always-on.md`. Regenerate them with `node scripts/build-plugin.mjs`; verify freshness with `node scripts/build-plugin.mjs --check` and content with `node scripts/check-static.mjs`.

Host formats: [Claude Code](https://code.claude.com/docs/en/plugins-reference), [Codex](https://developers.openai.com/plugins/build/plugins), [Cursor](https://cursor.com/docs/reference/plugins).

Licensed under [MIT](LICENSE).

<!-- arkiv-install:end -->

## Maintainer SDK compatibility

After installing the pinned verification dependencies with `npm ci --prefix tests/snippets --ignore-scripts --no-audit --no-fund`, run `node --test tests/snippets/sdk-compatibility.test.mjs`. CI also runs `node scripts/check-sdk-compatibility.mjs /absolute/path/sdk-compatibility.json`: a published SDK version outside the declared supported range fails CI. Unavailable or malformed registry metadata produces a nonzero operational result rather than an invented compatibility verdict.

The source watcher shares the canonical SemVer parser. Its health evidence remains separate: new, unverified SDK versions or cited documentation changes require re-verification and keep affected skills yellow; only a current observed failure makes them red. The compatibility diagnostic is not a health report and does not add an eighth producer.
