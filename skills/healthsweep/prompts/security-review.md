Security review of the changes on this branch (the same job as a /security-review pass, run here so it lands in one findings list).

{{context}}

Diff to review: run `git -C {{repoRoot}} diff {{mergeBase}}..HEAD`. Review only flaws the change introduces or touches: injection, authn/authz gaps, IDOR, secrets, unsafe deserialization, SSRF, race conditions in access or state-changing decisions, sensitive data in logs or responses. Use category "security" (or "bug" for non-security defects you notice). Quote the changed lines as evidence.

{{>_rules-readonly}}
