import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCli } from './helpers.js';

describe('anchor-cctp usage', () => {
  test('prints usage diagnostics to stderr on unknown or empty command', async () => {
    const { stderr, code } = await runCli([]);
    expect(code).toBe(0);
    expect(stderr).toContain('Usage: anchor-cctp');
  });

  test('banner version matches package.json', async () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string };
    const { stderr } = await runCli([]);
    expect(stderr).toContain(`AnchorCCTP CLI v${pkg.version}`);
  });
});
