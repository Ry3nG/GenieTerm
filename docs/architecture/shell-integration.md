<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Shell integration

Shell startup scripts in `pkg/util/shellutil/shellintegration/` emit OSC 16162 sequences through the PTY. `frontend/app/view/term/termwrap.ts` registers xterm handlers implemented in `osc-handlers.ts` in the same directory. These markers identify prompts, commands, and exit status within one terminal stream.

## OSC 16162

The emitted format is:

```text
ESC ] 16162 ; command [ ; JSON ] BEL
```

`ESC` is byte `0x1b`; `BEL` is `0x07`. Command text and input buffers use base64 so quotes, newlines, and control characters do not interfere with JSON framing.

| Command | Payload fields                                                 | Meaning                                                                                      |
| ------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `A`     | None                                                           | Prompt starts; register a prompt marker and mark the shell ready                             |
| `C`     | `cmd64`                                                        | Command starts; optional base64 command text                                                 |
| `D`     | `exitcode`                                                     | Command completes; missing status remains unknown                                            |
| `M`     | `shell`, `shellversion`, `uname`, `integration`, `omz`, `comp` | Shell metadata and integration capabilities                                                  |
| `I`     | `inputempty`, `buf64`, `cur`, `len`, `toolarge`                | Input state; the Zsh integration can report the buffer and cursor for completion             |
| `R`     | None                                                           | Shell restart/reset; finalize pending command state and leave the alternate screen if active |

Fields are optional, and scripts differ in which they emit. For example, `cur` is a character offset that `TermWrap.handleInputReport()` converts to a JavaScript string index. The input report is richer than a boolean “buffer empty” signal.

A typical prompt cycle is `M`, `A`, then `C`, command output, `D`, and the next `A`. The initial prompt has no preceding exit status. Zsh uses precmd/preexec and line-editor hooks; Bash uses the bundled bash-preexec integration; Fish and PowerShell have their own hooks. The scripts suppress semantic integration inside tmux/screen environments. Bash also reports disabled integration when extdebug or missing bash-preexec support prevents normal hooks.

`handleOsc16162Command()` consumes the OSC even when data is empty or malformed, keeping parser errors from propagating through xterm's write queue. `decodeOsc16162CommandText()` catches base64 failures and substitutes a non-executable placeholder when its estimated decoded size exceeds 8 KiB. New consumers must not treat that placeholder as a command to copy or rerun.

## Command blocks and replay

`frontend/app/view/term/cmdblocks.ts` defines the `CmdBlock` model. `TermWrap.onPromptStart()` creates a pending block at an xterm marker. `onCommandStart()` records command text, an output marker, time, and current directory. `onCommandDone()` records completion and exit status. The next prompt bounds the previous region; prompts with no command are removed. A missing completion marker or shell reset can leave a command marked interrupted.

These records annotate the existing xterm buffer. They do not create a PTY or xterm instance for every command. Their marker lifetime follows terminal scrollback, and terminal cache snapshots include an index of command blocks.

Restoring history uses a separate replay path. It reconstructs markers and command state without live completion notifications or backend runtime-info writes. Replayed commands do not invent wall-clock timing or a current directory that the stream did not preserve. Keep live and replay behavior separate when extending the protocol.

Live shell state is also sent through `SetRTInfoCommand`, using keys such as `shell:state`, `shell:lastcmd`, and `shell:lastcmdexitcode`. This runtime information is separate from persisted block metadata.

## Working directory

OSC 7 reports the current directory as `file://<hostname><encoded-path>`. `handleOsc7Command()` decodes and normalizes the path, updates `cmd:cwd` through `SetMetaCommand`, and records `shell:hascurcwd` through `SetRTInfoCommand`. Reporting cadence depends on the shell: Bash emits it at each prompt, while Zsh also uses a directory-change hook. History loading does not apply old directory reports to current block metadata.
