---
name: push-to-main
description: Push all current changes to the main branch. If not on main, merge current branch into main first, then push.
user_invocable: true
---

# Push to Main

Push the current branch's changes to the main branch on the remote.

## Steps

1. **Check current branch**: Run `git branch --show-current` to determine the current branch.

2. **Commit any uncommitted changes**:
   - Run `git status` to check for staged/unstaged/untracked changes.
   - If there are changes, stage all changes with `git add -A` and commit with a descriptive message summarizing the changes.
   - Use `git diff --staged` and `git log` to craft a good commit message following the repo's style.

3. **If already on main**:
   - Run `git push origin main` to push changes to remote.

4. **If on a different branch** (e.g., `feature/optimization`):
   - Switch to main: `git checkout main`
   - Pull latest main to avoid conflicts: `git pull origin main`
   - Merge the feature branch into main: `git merge <branch-name>`
   - If there are merge conflicts, stop and inform the user about the conflicts so they can resolve them.
   - If merge succeeds, push to remote: `git push origin main`
   - Switch back to the original branch: `git checkout <branch-name>`

5. **Report the result** to the user (success or any issues encountered).

## Important

- Never force push (`--force` or `-f`).
- If there are merge conflicts, do NOT attempt to auto-resolve. Inform the user and let them handle it.
- Always switch back to the original branch after pushing to main.
