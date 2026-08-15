# Shared Agent Context

This directory is a project-local interoperability layer for coding agents. It is not a copy of the project and does not synchronize private chat databases.

- `HANDOFF.md`: concise continuation context
- `TASKS.md`: shared task state
- `MEMORY.md`: durable, non-secret project facts
- `DECISIONS.md`: technical decisions and rationale
- `TESTS.md`: latest test evidence
- `project-state.json`: versioned machine-readable summary
- `locks/`: machine-local advisory locks (Git-ignored)
- `sessions/`: private local summaries (Git-ignored)

Never store API keys, cookies, tokens, full chat transcripts, or machine credentials here.
