'use strict';

// Per-command allowlists of read-only subcommands/verbs.
//
// bash-rewrite.js auto-grants permission (`permissionDecision: 'allow'`) for any
// command it rewrites. That's fine for commands with no destructive form
// (ls/grep/find/cat/head/tail/rg/ag, test runners, lint/build tools, package
// installs) — matching the first word is enough. But `git`, `docker`, `kubectl`
// and `aws` are multi-purpose: `git status` is read-only, `git push --force` and
// `git reset --hard` are not; `docker ps` is read-only, `docker rm -f` is not;
// same shape for `kubectl` (get vs delete) and `aws` (describe/list/get vs
// terminate/delete/rm). Matching only the first word would auto-allow those too.
//
// isSafeSubcommand checks the subcommand/verb for these four gated commands.
// Anything not in GATED has no mutating form and is safe by construction.

const GIT_SAFE = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'describe', 'rev-parse',
  'ls-files', 'ls-tree', 'shortlog', 'cat-file', 'diff-tree', 'reflog',
]);

const DOCKER_SAFE = new Set([
  'ps', 'images', 'inspect', 'logs', 'version', 'info', 'top', 'history', 'port', 'diff',
]);

const KUBECTL_SAFE = new Set([
  'get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources', 'api-versions',
]);

// `aws <service> <verb> ...` — the verb is the third token. Read-only verbs are
// conventionally prefixed describe-/list-/get- (or plain "ls" for `aws s3`).
const AWS_SAFE_VERB_RE = /^(describe|list|get|ls)[-\w]*$/i;

const GATED = { git: GIT_SAFE, docker: DOCKER_SAFE, kubectl: KUBECTL_SAFE };

function isSafeSubcommand(firstWord, tokens) {
  if (firstWord === 'aws') {
    const verb = tokens[2];
    return typeof verb === 'string' && AWS_SAFE_VERB_RE.test(verb);
  }
  const safeSet = GATED[firstWord];
  if (!safeSet) return true;
  return safeSet.has(tokens[1]);
}

module.exports = { isSafeSubcommand, GIT_SAFE, DOCKER_SAFE, KUBECTL_SAFE, AWS_SAFE_VERB_RE, GATED };
