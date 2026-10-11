# Roadmap

GenieTerm is a terminal for people who work on remote machines. It brings three things together: command blocks over a real shell, SSH sessions that survive disconnects, and the remote machine's files and resources next to the shell. What's shipped is in the [release notes](docs/releases/).

## Principles

- **One terminal runtime.** Command blocks are a presentation over an ordinary xterm session, never a separate shell. Because xterm can't fold away lines, GenieTerm offers "jump past output" instead of collapsing blocks.
- **AI proposes, you decide.** Command AI writes, fixes and explains commands for you to review, using an AI you already have. GenieTerm has no AI service, chat panel or agent of its own, and it never runs a command on its own.
- **Local first.** GenieTerm has no account, no telemetry and no cloud service.
- **Compatible underneath.** Internal names inherited from Wave Terminal stay as they are, so existing data and remote helpers keep working across updates.

## Next

- Signed and notarized macOS builds, and signed Windows builds on the stable channel.
- A per-host list of durable sessions.
- Selecting several remote files for one transfer.
- Port forwards that persist across restarts.
- Handing a bigger task from Command AI to Claude Code or Codex in a new terminal, in the same folder and host.

## Later

- Saved workflows in the command palette.
- A richer input editor on top of the same xterm session.

## Known limitations

- The Windows build is an unsigned preview. PowerShell command blocks haven't been tested on real Windows hardware yet.
- The Host view shows NVIDIA GPUs only. On Windows it doesn't list listening ports.
- On Ubuntu 23.10 and later, the AppImage runs without Chromium's sandbox. The `.deb` keeps the sandbox on.
- Folder downloads over rsync don't show a percentage.
- Copying from a host without the helper to a host with it buffers whole files, and refuses folders and very large files with a clear error.
- Re-running a command, or inserting one from Command AI, clears the line with Ctrl-E Ctrl-U, which shells in vi mode may not honor.
- Command AI's Codex and Claude Code engines run on this computer, so they need to be installed here, not on the remote host. Gemini works through its OpenAI-compatible endpoint rather than the Gemini CLI.
