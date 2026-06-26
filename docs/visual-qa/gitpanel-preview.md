# Git Panel Visual QA

Date: 2026-06-27

Preview URL:

```text
http://localhost:7007/?preview=gitpanel
```

## Covered States

- Dense working tree with merge, staged, unstaged, untracked, and renamed files.
- Unified diff preview with multiple files and line numbers.
- Git graph with refs, branches, tags, merge parents, selected commit details, and changed files.
- Detached HEAD checkout confirmation state.
- Clean repository empty state.
- Non-repository error state.

## Result

- No blank Git graph or diff surface observed.
- No obvious text overlap in the inspected desktop viewport.
- Diff rows preserve line-number columns and readable add/delete colors.
- Graph rows keep commit/date/author/hash columns aligned under dense refs.
- Detached checkout confirmation is rendered inside the Git panel with cancel and confirm affordances.
- Error and empty states are visible and not silent.

## Follow-Up

- Add a screenshot runner so this preview can be captured at fixed desktop and narrow widths.
- Split the fixture into separate preview entries if narrow screenshots become too crowded.
- Replace the native detached-HEAD confirmation with an app-native modal before v1.0.0.
