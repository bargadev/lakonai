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
// Anything not in GATED has no mutating form we gate here — see the PR/commit
// history for known out-of-scope gaps (e.g. npm/cargo publish, learned commands).

const GIT_SAFE = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'describe', 'rev-parse',
  'ls-files', 'ls-tree', 'shortlog', 'cat-file', 'diff-tree',
]);

const DOCKER_SAFE = new Set([
  'ps', 'images', 'inspect', 'logs', 'version', 'info', 'top', 'history', 'port', 'diff',
]);

const KUBECTL_SAFE = new Set([
  'get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources', 'api-versions',
]);

// `aws <service> <verb> ...` — the verb is the third token. Read-only verbs are
// conventionally prefixed describe-/list-/get- (or plain "ls" for `aws s3`), but
// a handful of get-* verbs return long-lived or session credentials rather than
// resource metadata — those must never be auto-allowed even though they match
// the naming convention.
const AWS_SAFE_VERB_RE = /^(describe|list|get|ls)[-\w]*$/i;
const AWS_CREDENTIAL_VERBS = new Set([
  'get-login-password', 'get-session-token', 'get-federation-token',
  'get-token', 'get-credentials', 'get-secret-value',
]);

const GATED = { git: GIT_SAFE, docker: DOCKER_SAFE, kubectl: KUBECTL_SAFE };

function isSafeSubcommand(firstWord, tokens) {
  if (firstWord === 'aws') {
    if (tokens[1] === 'configure') return false; // `aws configure get <secret-key>`
    const verb = tokens[2];
    if (typeof verb !== 'string') return false;
    if (AWS_CREDENTIAL_VERBS.has(verb.toLowerCase())) return false;
    return AWS_SAFE_VERB_RE.test(verb);
  }
  const safeSet = GATED[firstWord];
  if (!safeSet) return true;
  return safeSet.has(tokens[1]);
}

// A subcommand allowlist only means something if the whole string is a single,
// unchained invocation with no destructive side channel. This regex blocks:
//   - command separators/chaining: `;`, `&&`, `||`, a bare `|`, a bare `&`
//     (background operator — `cmd1 & cmd2` runs both, no `&&` needed)
//   - command substitution: backticks, `$(...)`
//   - process substitution: `<(...)`, `>(...)` (spawns a subshell immediately,
//     even if the outer command never reads/writes the fd)
//   - a newline (equivalent to `;`)
//   - output redirection: `>`, `>>`, `&>` (lets an otherwise read-only command
//     like `git log` or `echo` overwrite an arbitrary file)
// Any of these let an otherwise-safe subcommand smuggle an arbitrary or
// destructive side effect through the same permission grant, e.g.
// `git status && git push --force`, `ls -la; rm -rf ~`, `git status & git push
// --force`, `git status <(git push --force)`, or `echo pwned > ~/.zshrc`. This
// isn't limited to the four gated commands above: any auto-allowed command
// (ls, grep, cat, ...) can carry a chained/redirected payload the same way, so
// this check runs unconditionally in bash-rewrite.js.
const CHAIN_RE = /;|&&|&|\|\||\||`|\$\(|<\(|>\(|>|\n/;

function hasUnsafeChaining(command) {
  return CHAIN_RE.test(command);
}

module.exports = {
  isSafeSubcommand,
  hasUnsafeChaining,
  GIT_SAFE,
  DOCKER_SAFE,
  KUBECTL_SAFE,
  AWS_SAFE_VERB_RE,
  AWS_CREDENTIAL_VERBS,
  GATED,
  CHAIN_RE,
};
