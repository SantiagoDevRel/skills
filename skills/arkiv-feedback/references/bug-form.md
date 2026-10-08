# Bug form — checked 2026-10-08

Source: [upstream bug form](https://github.com/Arkiv-Network/reported-issues/blob/main/.github/ISSUE_TEMPLATE/1-bug.yml), [raw YAML](https://raw.githubusercontent.com/Arkiv-Network/reported-issues/main/.github/ISSUE_TEMPLATE/1-bug.yml). Keep heading labels verbatim. Upstream's DB-chain options omit Tiramisu; offer Tiramisu first, then Local / devnet and `Other (please describe in the steps)`. Do not recommend retired networks. If the user reports an older network, retain their actual context in the repro rather than pretending it was Tiramisu. In the web-form fallback, select Other and explain Tiramisu in the steps.

Title prefix: `[Bug]: `. The web form prefills it; paste only the summary. Upstream labels: `bug`, `triage`, `reported-issue`; issue type: `bug`; project: `Arkiv-Network/4`. CLI submission may omit this metadata; labels require explicit flags and suitable permissions. Do not promise they are auto-applied by `gh`.

| Heading | Required? |
| --- | --- |
| How can we reach you? | No |
| Which DB-chain? | Yes |
| Where did you hit the issue? | Yes |
| SDK / tool version | No |
| What happened? | Yes |
| Steps to reproduce | Yes |
| Relevant logs or error output | No |
| Transaction hash or entity ID (if any) | No |
| Anything else we should know? | No |

Surface options: `SDK (@arkiv-network/sdk)`, `CLI / tooling`, `Block explorer`, `Entity Explorer (data.arkiv.network)`, `Documentation`, `Website`, `Other`. These are literal option values; formatting backticks are not part of the submitted value. Example current SDK version: `@arkiv-network/sdk@0.8.1`. Contact information will be public: let the user omit it.

```markdown
### How can we reach you?
{{contact or "_No response_"}}

### Which DB-chain?
{{db-chain}}

### Where did you hit the issue?
{{surface}}

### SDK / tool version
{{version or "_No response_"}}

### What happened?
{{what-happened}}

### Steps to reproduce
{{repro}}

### Relevant logs or error output
{{redacted logs in a safe shell fence, or "_No response_" without a fence}}

### Transaction hash or entity ID (if any)
{{tx or "_No response_"}}

### Anything else we should know?
{{extra or "_No response_"}}
```

Ask for observed behavior, expected behavior and a reproducible example. Include explorer links when available. Never include signing keys, seed phrases, access keys or private URLs. Empty optional logs use the placeholder alone; do not wrap that placeholder as executable-looking code.

The fenced template is for a CLI Markdown body. The web logs field already renders as shell code: paste redacted, unfenced text there and neutralize runs of three or more backticks. For CLI logs, choose a fence longer than every backtick run in the supplied text.
