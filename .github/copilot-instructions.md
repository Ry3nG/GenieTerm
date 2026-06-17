# GenieTerm — Copilot Instructions

## Project Rules

- See the overview of the project in `.kilocode/rules/overview.md`.
- Read and follow all guidelines in `.kilocode/rules/rules.md`.
- GenieTerm is a private product fork built on the Wave Terminal codebase. User-facing product copy should say GenieTerm.
- Preserve internal API names such as `wsh`, `WaveEnv`, and WPS unless there is an explicit product decision to migrate them.
- Prefer workspace-native workflow improvements over broad AI assistant surface area.

## Skill Guides

This project uses focused implementation guides for common tasks. When a task matches one of the descriptions below, read the linked `SKILL.md` before editing code.

| Skill        | File                                     | Description                                                                                                                                                                 |
| ------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add-config   | `.kilocode/skills/add-config/SKILL.md`   | Guide for adding new configuration settings, config keys, and user-customizable settings.                                                                                   |
| add-rpc      | `.kilocode/skills/add-rpc/SKILL.md`      | Guide for adding new RPC calls, server-client communication methods, and RPC interface extensions.                                                                          |
| add-wshcmd   | `.kilocode/skills/add-wshcmd/SKILL.md`   | Guide for adding new `wsh` commands and command-line functionality.                                                                                                         |
| context-menu | `.kilocode/skills/context-menu/SKILL.md` | Guide for creating context menus, menu items, submenus, checkboxes, and separators.                                                                                         |
| create-view  | `.kilocode/skills/create-view/SKILL.md`  | Guide for implementing a new view type, ViewModel integration, BlockRegistry registration, or a new block content type.                                                     |
| electron-api | `.kilocode/skills/electron-api/SKILL.md` | Guide for adding Electron APIs via preload/IPC.                                                                                                                            |
| waveenv      | `.kilocode/skills/waveenv/SKILL.md`      | Guide for creating WaveEnv narrowings, documenting component environment dependencies, and enabling mock environments for previews/tests.                                    |
| wps-events   | `.kilocode/skills/wps-events/SKILL.md`   | Guide for working with WPS events, including publishing, subscribing, and asynchronous communication between components.                                                     |

## Preview Server

To run the standalone component preview:

```sh
task preview
```

This runs `cd frontend/preview && npx vite` and serves at `http://localhost:7007`.

To build a static preview:

```sh
task build:preview
```

Do not use root-level `npm run dev`, `npm run start`, or `npx vite` when the goal is the standalone preview.
