#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDomainsCommand } from './commands/domains.js';
import { runInitCommand } from './commands/init.js';
import { runListenCommand } from './commands/listen.js';
import { runVerifyCommand } from './commands/verify.js';

// Read the version from the package manifest so the banner can never drift from
// what was published. Resolves to packages/cli/package.json both in the repo
// (dist/../package.json) and in the published tarball, which always ships it.
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (command === 'domains') return runDomainsCommand();
  if (command === 'init') return runInitCommand(commandArgs);
  if (command === 'verify') return runVerifyCommand(commandArgs);
  if (command === 'listen') return runListenCommand(commandArgs);

  // Diagnostics to stderr
  process.stderr.write(`AnchorCCTP CLI v${readVersion()}\nUsage: anchor-cctp <init|listen|verify|domains>\n`);
  return 0;
}

// Set exitCode and let the loop drain instead of calling process.exit().
// Commands that hit the network leave an AbortSignal.timeout() timer pending;
// force-exiting with that handle open trips a libuv assertion on Windows
// ("!(handle->flags & UV_HANDLE_CLOSING), src\win\async.c") and yields exit 127.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: Error) => {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    process.exitCode = 1;
  });
