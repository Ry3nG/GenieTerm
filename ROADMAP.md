# Roadmap

GenieTerm is a terminal for people who work on remote machines. It brings three things together: command blocks over a real shell, SSH sessions that survive disconnects, and the remote machine's files and resources next to the shell. What's shipped is in the [release notes](docs/releases/).

## Principles

- **One terminal runtime.** Command blocks are a presentation over an ordinary xterm session, never a separate shell. Because xterm can't fold away lines, GenieTerm offers "jump past output" instead of collapsing blocks.
- **AI proposes, you decide.** Command AI writes, fixes and explains commands for you to review, using an AI you already have. GenieTerm has no AI service, chat panel or agent of its own, and it never runs a command on its own.
- **Local first.** GenieTerm has no account, no telemetry and no cloud service.
- **Compatible underneath.** Internal names inherited from Wave Terminal stay as they are, so existing data and remote helpers keep working across updates.

## Next

- Signed and notarized macOS builds, and signed Windows builds on the stable channel.
- Repeatable end-to-end SSH measurements with several sessions sharing a saturated connection, including disconnects and older remote managers.
- Windows local listening-port discovery and broader interactive shell validation.

## Available now

- Per-host durable-session lists, reconnect actions and saved port forwards with opt-in restoration.
- Batch file copies and downloads with retry, cancellation and conflict choices.
- Authenticated folder downloads with byte/file progress, plus streaming cross-host copies where SFTP is available.
- Shell-native prompt replacement, responsive explicit controls under input backpressure, and visible SSH output gaps.
- Reviewed Command AI context handoff to Codex or Claude Code in the same host and directory.
- Repeated packaged performance measurements and CI evidence for startup, memory, foreground echo and concurrent output.
- Compact command history and output search. Command recipes and workspace templates were removed in 1.6.2; they are not planned for reintroduction.

Further input editing work should stay on the existing shell and xterm session. Prioritize demonstrated input, restoration and transfer problems before adding new management surfaces; see [product direction](docs/product-direction.md).

## Known limitations

- Windows installers remain unsigned. Native PowerShell and packaged SSH checks have passed; coverage and remaining gaps are recorded in [Windows validation](docs/windows-validation.md).
- The Host view shows NVIDIA GPUs only. On Windows it doesn't list listening ports.
- On Ubuntu 23.10 and later, the AppImage runs without Chromium's sandbox. The `.deb` keeps the sandbox on.
- Durable sessions retain a bounded amount of output while disconnected. A surviving process does not imply complete output retention or survival of a host reboot.
- A helper-enabled destination without an SFTP subsystem still uses the bounded legacy fallback for copies from SFTP-only hosts; that fallback refuses directories and files over 32 MiB.
- Existing remote managers and shells retain their loaded code after an app upgrade. New input controls and native prompt replacement require newly started managers/shells; older sessions remain compatible.
- Command AI's Codex and Claude Code engines run on this computer, so they need to be installed here, not on the remote host. Gemini works through its OpenAI-compatible endpoint rather than the Gemini CLI.
