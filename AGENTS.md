# AGENTS.md

## Project

MADOHA is an **AI Search Intelligence Platform**.

It measures and visualizes how companies and stores are recognized, recommended, compared, and referenced by AI search systems.

Repository: `madoha-site`  
Production branch: `main`  
Cloudflare Worker: `icy-leaf-b200`  
Production domain: `madoha.jp`

GitHub `main` is the source of truth for production code.

## Development Rules

- Do not break existing functionality unless the task explicitly requires replacing it.
- Keep the existing GitHub → Cloudflare Workers deployment flow intact.
- Do not create a new Worker or change production infrastructure without explicit instruction.
- Always consider both desktop and mobile layouts.
- Do not simply shrink the desktop UI for mobile when a separate mobile treatment is appropriate.
- Check Japanese text for:
  - unnatural line breaks
  - overlapping or hidden text
  - text that is too small
  - excessive or broken spacing
  - layout misalignment
- Use fonts suitable for Japanese, such as Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Noto Sans JP, or Meiryo.
- Prioritize a modern, refined AI-product UI with meaningful 3D and data visualization.
- Do not use 3D only as decoration. It should communicate relationships, structure, status, or data where possible.
- Avoid unnecessary dependencies and libraries.
- Do not introduce APIs, paid services, subscriptions, or new recurring costs without explicit approval.
- If a change may generate API usage costs, confirm before implementation.
- Mock data must be structured so it can later be replaced by real data without rebuilding the UI.
- Do not design product-critical UI around data that cannot realistically be acquired.
- Keep data acquisition, transformation, and presentation reasonably separated where practical.
- Prefer simple, maintainable implementations over unnecessary complexity.

## Validation

After changes:

- Run the project build and fix introduced errors.
- Check the major affected screens.
- Check desktop and mobile responsive behavior.
- Check Japanese typography, spacing, alignment, overflow, and readability.
- Confirm the Cloudflare Workers deployment configuration has not been unintentionally changed.

Do not push knowingly broken code to `main`.

## Scope

This file contains only persistent project-wide rules.

Do not add:
- screen-specific specifications
- temporary requirements
- individual feature designs
- one-off implementation instructions

Those belong in each `CODEX TASK`.

## Completion Report

At the end of every Codex task, report:

DONE:
- What was implemented

CHANGED:
- Files changed

TESTED:
- Build, UI, responsive, and other checks performed

ISSUES:
- Remaining issues or risks
- Write `None` if there are none

NEXT:
- Recommended next step
