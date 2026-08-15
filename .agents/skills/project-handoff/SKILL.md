---
name: project-handoff
description: Safely continue or hand off work between Codex and DeepSeek in the same real project directory.
---

# Project Handoff

1. Confirm the current working directory is the exact project root and do not copy the project.
2. Read `AGENTS.md`, `.agents/HANDOFF.md`, `.agents/TASKS.md`, `.agents/MEMORY.md`, `.agents/DECISIONS.md`, and `.agents/TESTS.md` when present.
3. Check `.agents/locks/project-lock.json`. Do not edit while another non-stale agent owns the lock.
4. Verify claims against Git status, file contents, and test output before continuing.
5. Preserve unrelated changes and never overwrite another agent's concurrent edits.
6. Before yielding, record completed and pending work, changed files, decisions, tests, blockers, and the next action. Do not copy secrets or full chat transcripts into shared files.
