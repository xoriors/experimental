---
title: Deploy flow
---

# Deploy flow

Every node below carries an action, and every action is declared inside the Mermaid block with a
`click … href` line. There is no script in this file. GitHub shows the diagram without the clicks,
Obsidian follows the plain links, and the viewer (`viewer.html` next to this folder) executes the `action:` ones.

```mermaid
---
title: weather-voodoo release
---
flowchart LR
  classDef warn fill:#ffe9e6,stroke:#c62828,color:#7f1d1d

  build[Build on CI] --> test{Tests pass?}
  test -- yes --> deploy[Deploy to Vercel]
  test -- no --> fix[Fix]
  deploy --> smoke[Smoke check]
  smoke --> finish((Done))
  smoke -. failed .-> rollback[Roll back]
  class fix,rollback warn

  click build href "https://github.com/xoriors/experimental/actions" "Open CI"
  click test href "#tests" "Jump to the Tests section"
  click deploy href "action:copy?text=vercel%20deploy%20--prod%20--yes" "Copy the deploy command"
  click fix href "action:copy?text=git%20checkout%20-b%20fix%2Ftests" "Copy a branch command"
  click smoke href "action:toggle?class=checked" "Mark as done"
  click rollback href "action:show?id=rollback-steps" "Show the rollback steps"
  click finish href "./runbook.md#after-a-release" "Open the runbook"
```

| Node | Action | How it is written |
|---|---|---|
| Build on CI | open a page | `href "https://…"` |
| Tests pass? | jump to a heading in this doc | `href "#tests"` |
| Deploy, Fix | copy a command to the clipboard | `href "action:copy?text=…"` |
| Smoke check | toggle a state class on the node | `href "action:toggle?class=checked"` |
| Roll back | open a `<details>` block further down | `href "action:show?id=rollback-steps"` |
| Done | open another doc at a heading | `href "./runbook.md#after-a-release"` |

## Tests

The CI job runs `pnpm test` and `pnpm check` in `weather-voodoo/`. A red run blocks the deploy; the
diagram's **Fix** node copies the branch command for the fix.

## Rollback

<details id="rollback-steps">
<summary>Rollback steps</summary>

1. Open the Vercel dashboard for the project.
2. Pick the previous production deployment and promote it.
3. Note the failing commit in the release issue.

</details>

## Backlog

Kanban cards link to issues through `ticketBaseUrl` in the diagram's frontmatter. Mermaid fills in
the number, so the whole board stays plain text.

```mermaid
---
config:
  kanban:
    ticketBaseUrl: "https://github.com/xoriors/experimental/issues/#TICKET#"
---
kanban
  Todo
    t1[Persist toggled state back into the doc]@{ ticket: 54, priority: "High" }
    t2[Second theme preset]@{ ticket: 55 }
  Doing
    t3[Viewer renders whole Markdown docs]@{ ticket: 53 }
  Done
    t4[Actions declared as click href]@{ ticket: 52 }
```
