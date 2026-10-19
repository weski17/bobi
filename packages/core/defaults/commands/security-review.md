---
description: Review the code (or the current changes) for security issues
mode: security
---
Do a security review.

Scope: $ARGUMENTS
(If no scope is given, review the uncommitted and staged changes – `git diff HEAD` – and the code they touch; if there
are none, review the most security-relevant parts of the project: authentication, input handling, file and network
access, secrets, dependencies.)

For each finding give: severity (critical/high/medium/low), file and line, what is wrong, how it can be exploited,
and the fix. Check dependencies with the project's own audit tool if there is one. Finish with a short summary table.
Then offer to apply the fixes; propose each fix as a separate edit for the user to approve.
