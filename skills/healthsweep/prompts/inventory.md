Split this repository's source into at most {{maxModules}} modules for an audit.

{{context}}
Scope (empty = whole repository): {{scope}}
Exclude: {{exclude}}

Group by feature/domain directories that contain real source code. Exclude vendored code, node_modules, build output, generated code, fixtures and docs. Each module lists its paths (directories or files, repository-relative). Every source directory inside the scope must belong to exactly one module or be listed in skipped with a reason.

{{>_rules-readonly}}
