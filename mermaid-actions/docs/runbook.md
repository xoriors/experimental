---
title: Runbook
---

# Runbook

A second document, so the **Done** node in [`deploy-flow.md`](./deploy-flow.md) has somewhere to
jump to. Its own diagram links back.

```mermaid
flowchart TB
  check[Check the production URL] --> logs[Read the function logs]
  logs --> ok{Healthy?}
  ok -- yes --> close[Close the release issue]
  ok -- no --> back[Return to the deploy flow]

  click check href "https://weather-voodoo.vercel.app" "Open production"
  click logs href "action:copy?text=vercel%20logs%20weather-voodoo%20--prod" "Copy the logs command"
  click back href "./deploy-flow.md#rollback" "Back to the rollback section"
```

## Before a release

Run the i18n check described in `weather-voodoo/CLAUDE.md` and confirm the preview deployment.

## After a release

Open the production URL, watch the logs for five minutes, then close the release issue.
