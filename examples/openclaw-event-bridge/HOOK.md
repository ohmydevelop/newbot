---
name: newbot-events
description: Export selected lifecycle observations to a Newbot event relay.
metadata:
  openclaw:
    events: ["message:received", "message:sent", "command:reset"]
---

Exports only selected message metadata and a bounded text preview. Configure NEWBOT_EVENT_URL,
NEWBOT_EVENT_TOKEN, NEWBOT_EVENT_SOURCE and NEWBOT_EVENT_OUTBOX before enabling this hook.
The local outbox persists events before sending; the relay token only grants publication to its route.
