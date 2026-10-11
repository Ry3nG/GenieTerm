<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Onboarding

GenieTerm teaches by having the user do things in their own terminal. There are three surfaces: the welcome and What's New modals, Quick Start, and one-time tips.

## Welcome and What's New

`ModalsRenderer` opens the welcome modal (`onboarding.tsx`) until the client has agreed to the terms. **Get Started** agrees, records `onboarding:lastversion`, closes the modal and starts Quick Start. **Skip** records `onboarding:quickstart = "dismissed"` instead.

On the primary window's startup, a client whose `onboarding:lastversion` is older than `CurrentOnboardingVersion` (`onboarding-common.tsx`) gets What's New (`onboarding-upgrade.tsx`). It lists the releases since that version and offers **Start Quick Start** or **Not Now**.

## Quick Start

`OnboardingModel` (`onboarding-model.ts`) is a small state machine:

```
command ──command-done──► blocks ──Next──► commandai ──commandai-applied──► files ──cwd-files-opened──► done
```

Every step except `blocks` and `done` advances only on a real action, reported through `onboarding-events.ts`:

| Event               | Emitted by                                 | When                                                                      |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `command-done`      | `TermWrap.onCommandDone`                   | A command finishes; replayed history never emits                          |
| `commandai-opened`  | `TermCommandAiModel.open`                  | The Command AI sheet opens                                                |
| `commandai-applied` | `TermCommandAiModel.apply` / `applyInline` | A proposal is inserted or run; copying and clipboard fallback don't count |
| `cwd-files-opened`  | `TermViewModel.openCwdInFiles`             | Clicking the cwd in the terminal header opened a Files block              |
| `connection-ready`  | `ChangeConnectionBlockModal`               | The user connected a block to a remote host                               |

The `commandai` step is skipped when Command AI is off for that terminal, and `command` explains itself when the shell has no integration.

`OnboardingGuideLayer` (`onboarding-quickstart.tsx`) is mounted next to `ModalsRenderer`, not inside it. Modals set `atoms.modalOpen`, which blocks keys from reaching blocks; the guide must leave the terminal fully usable. The layer hides while any modal is open.

The card anchors to real controls through `data-onboarding` attributes (`OnboardingAnchor`), scoped to the target block with `[data-blockid]`. A pulsing ring marks the control. If the control isn't on screen, the card docks in the block's bottom-right corner. For controls next to the prompt (the cwd link), the card always docks so it never covers what the user is typing.

Progress lives in client meta: `onboarding:quickstart` (`active`, `done` or `dismissed`) and `onboarding:quickstartstep`. Closing the card saves the step; **Quick Start** in the command palette resumes it, or starts over after `done`. Only the window that started Quick Start shows it, and only the primary window resumes it on startup.

## Tips

Tips use the same card. Each is shown once (`onboarding:tips`), at most one per session, and never while Quick Start is active:

- `fix`: the first failed command (not an interrupt, not a typed request that already got an inline suggestion) points at the action bar's sparkle. Opening Command AI on that block, or the next command finishing, closes it.
- `remote`: the first connection to a remote host points at Host on the widget rail, when the rail is visible.

## Testing

- `onboarding-model.test.ts` covers the state machine, persistence and tip rules.
- `termwrap.test.ts` and `term-commandai.test.ts` cover when events are emitted.
- The `onboarding` preview renders every card state; `scripts/preview-visual-qa.mjs` checks them at desktop and phone widths.
