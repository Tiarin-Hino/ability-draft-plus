# Git Workflow Instructions

## Branch Management Rules

### Starting New Work

1. **Check Current Branch**
   - Always check the current branch before starting new work
   - Run `git branch --show-current` or `git status`

2. **If on `main` branch:**
   - ALWAYS create a new feature/bugfix branch before making changes
   - Branch naming convention: `feature-name` or `bugfix-name` (use kebab-case)
   - Example: `git checkout -b preferred-resolution` or `git checkout -b fix-logger-shutdown`

3. **If on a different branch (not `main`):**
   - ASK the user: "I see you're currently on branch `{branch-name}`. Should I continue working on this branch, or create a new one?"
   - Wait for user confirmation before proceeding
   - Only proceed with changes after receiving user's decision

### After Implementation is Complete

1. **Commit Changes**
   - Create clear, descriptive commit messages
   - Follow the project's commit message format (include Claude Code attribution)
   - Separate commits by logical changes when appropriate

2. **Push to Remote**
   - Push the branch to remote: `git push -u origin {branch-name}`

3. **Create Pull Request**
   - Use `gh pr create` with descriptive title and detailed body
   - Include summary of changes, test plan, and any relevant details

4. **Merge Pull Request**
   - Merge using: `gh pr merge {pr-number} --squash --delete-branch`
   - This will squash commits and delete the remote branch

5. **Return to Main Branch**
   - Switch back to main: `git checkout main`
   - Pull latest changes: `git pull`
   - Verify you're up to date with: `git log --oneline -5`

### Example Workflow

```bash
# 1. Check current branch
git status

# 2. If on main, create new branch
git checkout -b new-feature-name

# 3. Make changes, then commit
git add .
git commit -m "Add new feature

Detailed description...

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# 4. Push to remote
git push -u origin new-feature-name

# 5. Create and merge PR
gh pr create --title "Title" --body "Description"
gh pr merge {pr-number} --squash --delete-branch

# 6. Return to main and update
git checkout main
git pull
```

### Important Notes

- **NEVER commit directly to `main`** - always use feature branches
- **ALWAYS ask before using an existing non-main branch**
- **ALWAYS return to `main` after merging** to prepare for next task
- Keep branch names descriptive and concise
- Delete branches after merging (handled automatically by `--delete-branch` flag)

This workflow ensures clean Git history and prevents conflicts between different features/fixes.
