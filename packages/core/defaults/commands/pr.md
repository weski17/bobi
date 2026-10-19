---
description: Create a pull request for the current branch
mode: code
---
Create a pull request for the current branch.

1. Run `git status --short`, `git branch --show-current` and `git log --oneline <base>..HEAD` (base: the default
   branch, usually main). If there are uncommitted changes, ask the user whether to commit them first.
2. Write a title (at most 72 characters) and a description with a short summary, the main changes as a list and how
   the change was tested. Base it only on the commits and the diff.
3. Push the branch if needed (`git push -u origin <branch>`) and create the pull request with the hosting tool the
   repository uses (for GitHub: `gh pr create --title … --body …`). Each command needs the user's approval.
4. Reply with the link to the pull request.

Additional instructions from the user: $ARGUMENTS
