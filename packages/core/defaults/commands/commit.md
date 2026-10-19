---
description: Write a commit message for the staged changes and commit them
mode: code
---
Create a git commit for the currently staged changes.

1. Run `git status --short` and `git diff --staged`. If nothing is staged, say so and stop – do not stage files
   yourself unless the user asks for it.
2. Run `git log -n 10 --format=%s` to follow the repository's message style (e.g. Conventional Commits).
3. Write a message: a subject line of at most 72 characters in the imperative mood, a blank line, and a short body
   that explains why the change was made when that is not obvious. Do not invent changes that are not in the diff.
4. Commit with `git commit -m "<subject>" -m "<body>"` (the user approves the command).

Additional instructions from the user: $ARGUMENTS
