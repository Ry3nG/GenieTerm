# Contributing To GenieTerm

GenieTerm is a private product fork. Keep changes on the product: semantic command blocks, durable remote sessions, and remote files. AI is natural-language → a proposed command, not a chat product.

## Expectations

- Prefer small, reviewable changes with clear verification.
- Keep user-facing copy branded as GenieTerm.
- Preserve internal protocol/API names (`wshrpc`, `Wave*`, `WAVETERM_*`) unless the migration is deliberate.
- Do not revive Wave AI chat, Tsunami, or Wave 0.12–0.14 onboarding.
- Add tests around terminal, transfer, preview, or IPC behavior.
- Update `docs/GENIETERM-ROADMAP.md` when shipped/next state changes.

## Development

See [BUILD.md](./BUILD.md) for setup, local running, packaging, and focused test commands.

## Issues

Use issues for product work items, bugs, and workflow ideas. Remote-file ergonomics and workspace continuity should be the default priority unless we explicitly decide otherwise.
