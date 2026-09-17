#!/usr/bin/env node
'use strict';
const { SessionLifecycleError, SessionLifecycleSupervisor, processAlive } = require('./supervisor');
function parseArgs(argv) {
  const args = {};
  const names = new Set(['registry', 'namespace', 'project', 'session', 'label', 'interval-ms', 'retry-ms', 'parent-pid', 'stdin-lifetime']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const name = token.startsWith('--') ? token.slice(2) : '';
    if (!names.has(name) || Object.hasOwn(args, name)) throw new SessionLifecycleError('INVALID_ARGUMENT', `Unknown or duplicate argument: ${token}`);
    args[name] = name === 'stdin-lifetime' ? true : argv[++i];
    if (args[name] === undefined || (typeof args[name] === 'string' && args[name].startsWith('--'))) throw new SessionLifecycleError('INVALID_ARGUMENT', `Missing value: --${name}`);
  }
  for (const name of ['registry', 'project', 'session']) if (!args[name]) throw new SessionLifecycleError('INVALID_ARGUMENT', `Required: --${name}`);
  const intervalMs = Number(args['interval-ms'] ?? 5000);
  const retryMs = Number(args['retry-ms'] ?? 5000);
  const parentPid = args['parent-pid'] === undefined ? undefined : Number(args['parent-pid']);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 10000 || !Number.isInteger(retryMs) || retryMs < 100 || retryMs > 300000
    || (parentPid !== undefined && (!Number.isInteger(parentPid) || parentPid < 1))) throw new SessionLifecycleError('INVALID_ARGUMENT', 'Invalid interval, retry or parent PID.');
  return { registryPath: args.registry, namespace: args.namespace, project: args.project, session: args.session,
    label: args.label, intervalMs, retryMs, parentPid, stdinLifetime: args['stdin-lifetime'] === true };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supervisor = new SessionLifecycleSupervisor({ ...options, isProcessAlive: processAlive, emit: event => process.stdout.write(JSON.stringify(event) + '\n') });
  const stop = () => { void supervisor.stop().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // EOF binds lifetime to the exact parent pipe, avoiding PID reuse and Windows signal semantics.
  if (options.stdinLifetime) {
    process.stdin.on('end', stop);
    process.stdin.on('error', stop);
    process.stdin.resume();
  }
  try { await supervisor.start(); }
  finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('end', stop); process.stdin.removeListener('error', stop);
    if (options.stdinLifetime) process.stdin.pause();
  }
}

module.exports = { parseArgs, main };
if (require.main === module) main().catch(error => { process.stderr.write(`${error.code || 'SESSION_LIFECYCLE_ERROR'}: ${error.message}\n`); process.exitCode = 1; });
