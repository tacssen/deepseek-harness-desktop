# Decisions

Updated: 2026-08-15T09:24:31.481Z

- Do not modify Codex SQLite, rollout JSONL, global state, credentials, or writer locks
- Do not claim full private-chat synchronization; use official read-only metadata/turn access plus structured project handoff
- Keep live shared state ignored by default; commit only templates and protocol documentation
- Do not publish, push, tag, or create a remote until the user explicitly authorizes release
