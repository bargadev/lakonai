'use strict';

const assert = require('node:assert/strict');
const { isSafeSubcommand, hasUnsafeChaining } = require('../src/hooks/safe-subcommand');

function tokens(cmd) {
  return cmd.trim().split(/\s+/);
}

test('commands with no destructive form are always safe', () => {
  for (const cmd of ['ls -la', 'grep -r foo', 'cat README.md', 'npm test']) {
    const t = tokens(cmd);
    assert.equal(isSafeSubcommand(t[0], t), true);
  }
});

test('git: read-only subcommands are safe', () => {
  for (const cmd of ['git status', 'git log --oneline', 'git diff HEAD~1', 'git show abc123', 'git blame file.js']) {
    const t = tokens(cmd);
    assert.equal(isSafeSubcommand('git', t), true);
  }
});

test('git: mutating subcommands are not safe', () => {
  for (const cmd of ['git push --force', 'git reset --hard', 'git clean -fd', 'git checkout .', 'git branch -D foo']) {
    const t = tokens(cmd);
    assert.equal(isSafeSubcommand('git', t), false);
  }
});

test('docker: read-only subcommands are safe, mutating ones are not', () => {
  assert.equal(isSafeSubcommand('docker', tokens('docker ps')), true);
  assert.equal(isSafeSubcommand('docker', tokens('docker logs my-container')), true);
  assert.equal(isSafeSubcommand('docker', tokens('docker rm -f my-container')), false);
  assert.equal(isSafeSubcommand('docker', tokens('docker stop my-container')), false);
});

test('kubectl: read-only subcommands are safe, mutating ones are not', () => {
  assert.equal(isSafeSubcommand('kubectl', tokens('kubectl get pods')), true);
  assert.equal(isSafeSubcommand('kubectl', tokens('kubectl describe pod my-pod')), true);
  assert.equal(isSafeSubcommand('kubectl', tokens('kubectl delete pod my-pod')), false);
  assert.equal(isSafeSubcommand('kubectl', tokens('kubectl apply -f manifest.yaml')), false);
});

test('aws: describe/list/get/ls verbs are safe, everything else is not', () => {
  assert.equal(isSafeSubcommand('aws', tokens('aws ec2 describe-instances')), true);
  assert.equal(isSafeSubcommand('aws', tokens('aws iam get-role --role-name foo')), true);
  assert.equal(isSafeSubcommand('aws', tokens('aws s3 ls')), true);
  assert.equal(isSafeSubcommand('aws', tokens('aws logs list-log-groups')), true);
  assert.equal(isSafeSubcommand('aws', tokens('aws s3 rm s3://bucket --recursive')), false);
  assert.equal(isSafeSubcommand('aws', tokens('aws ec2 terminate-instances --instance-ids i-123')), false);
  assert.equal(isSafeSubcommand('aws', tokens('aws')), false);
});

test('hasUnsafeChaining flags any command-chaining metacharacter', () => {
  for (const cmd of [
    'git status && git push --force',
    'ls -la; rm -rf ~',
    'git log || true',
    'grep -r foo . | sh',
    'echo `whoami`',
    'echo $(whoami)',
    'git status\ngit push --force',
  ]) {
    assert.equal(hasUnsafeChaining(cmd), true, `expected chaining detected in ${cmd}`);
  }
});

test('hasUnsafeChaining leaves plain single commands alone', () => {
  for (const cmd of ['git status', 'git log --oneline -20', 'docker ps -a', 'kubectl get pods -n default', 'aws s3 ls s3://bucket']) {
    assert.equal(hasUnsafeChaining(cmd), false, `expected no chaining detected in ${cmd}`);
  }
});
