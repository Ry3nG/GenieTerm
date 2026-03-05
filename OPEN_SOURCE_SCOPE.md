# Open Source Scope

## Public in This Repository

- **Terminal core**: PTY integration, ANSI parsing, screen model, snapshot APIs
- **Native client**: macOS UI, rendering, input routing, bridge layer
- **Interfaces**: C FFI API and headers used by the app
- **Quality tooling**: benchmarks, regression thresholds, reproducible scripts
- **Project docs**: architecture notes, roadmap, contribution process

## Not Published in This Repository

- Code-signing certificates, notarization credentials, release secrets
- Telemetry/analytics backend credentials and private dashboards
- Private API keys or internal service tokens
- Proprietary operational runbooks that expose security-sensitive internals

## Rule for Future Additions

If a component is required to build, run, verify performance, or understand product behavior, it should be open in this repo.

If a component is secret-bearing or purely operational infrastructure, it should stay private.
