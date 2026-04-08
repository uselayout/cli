# @layoutdesign/context

Open source MCP server + CLI that gives AI coding agents structured design system context.

## Changelog

**REQUIRED:** Before finishing any session that includes user-facing changes, add changelog entries to the web app repo:

- **File:** `/Users/matt/Cursor Projects/Layout/layout-studio/content/changelog/draft.ts`
- **Product:** `cli`
- **Categories:** `new`, `improved`, `fixed`
- Write for users, not developers

## Git Branching

**Branches:**
- `main` — production. Never push directly. Only merged from staging after testing.
- `staging` — integration branch. Staging site deploys from here.
- `staging/<feature>` — feature branches. All work happens here.

**Workflow (ALL Claude Code sessions MUST follow this):**
1. Start: `git checkout -b staging/<short-name> origin/staging`
2. Work: commit and push to your feature branch
3. Done: merge feature branch into staging, then delete it
4. Never push directly to staging or main

**Branch naming:** `staging/<short-description>` e.g. `staging/extraction-fixes`

**Need another session's changes?** `git pull origin staging --rebase`
