# Git Panel Visual QA

Date: 2026-06-27

Preview URL:

```text
http://localhost:7007/?preview=gitpanel
```

Automated capture:

```sh
task visual:preview
```

Screenshots are written to `artifacts/visual-qa/gitpanel-desktop.png` and
`artifacts/visual-qa/gitpanel-narrow.png`.

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

- Split the fixture into separate preview entries if narrow screenshots become too crowded.
