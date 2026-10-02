import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { AttestationClient } from '@anchor-cctp/core-sdk';
import { runInitCommand } from '../src/commands/init.js';
import { runListenCommand } from '../src/commands/listen.js';
import { runVerifyCommand } from '../src/commands/verify.js';

const TMP = path.join(os.tmpdir(), 'anchorcctp-cli-tests');
const VALID_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const VALID_HASH = '0x' + 'aa'.repeat(32);

interface Captured {
  stdout: string;
  stderr: string;
  reset(): void;
  restore(): void;
}

function captureOutput(): Captured {
  let stdout = '';
  let stderr = '';
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    reset() {
      stdout = '';
      stderr = '';
    },
    restore() {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

describe('init validation branches (in-process)', () => {
  let io: Captured;

  beforeEach(() => {
    io = captureOutput();
  });

  afterEach(() => {
    io.restore();
  });

  test('rejects an invalid usdc-issuer StrKey', async () => {
    const code = await runInitCommand(['--usdc-issuer', 'not-a-strkey']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_CONFIG');
    expect(parsed.error).toContain('usdc-issuer');
    expect(io.stderr).toContain('[ERROR]');
  });

  test('rejects an invalid forwarder StrKey', async () => {
    const code = await runInitCommand(['--forwarder', 'not-a-forwarder']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_CONFIG');
    expect(parsed.error).toContain('forwarder');
  });

  test('rejects an invalid dust-collector StrKey', async () => {
    const code = await runInitCommand(['--dust-collector', 'nope']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_CONFIG');
    expect(parsed.error).toContain('dust-collector');
  });

  test('blocks a traversal path unless --force is passed', async () => {
    const traversal = `${TMP}/sub/../forced.toml`;
    const resolved = path.join(TMP, 'forced.toml');

    const blocked = await runInitCommand(['--output', traversal]);
    expect(blocked).toBe(1);
    expect(JSON.parse(io.stdout).code).toBe('PATH_SECURITY');

    io.reset();
    const forced = await runInitCommand(['--output', traversal, '--force']);
    expect(forced).toBe(0);
    expect(JSON.parse(io.stdout).success).toBe(true);
    expect(existsSync(resolved)).toBe(true);

    unlinkSync(resolved);
  });

  test('refuses to overwrite an existing file, then overwrites with --force', async () => {
    const target = path.join(TMP, 'exists.toml');
    writeFileSync(target, 'original', 'utf8');

    const refused = await runInitCommand(['--output', target]);
    expect(refused).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('FILE_EXISTS');
    expect(parsed.remediation).toContain('--force');

    io.reset();
    const overwritten = await runInitCommand(['--output', target, '--force']);
    expect(overwritten).toBe(0);
    expect(JSON.parse(io.stdout).success).toBe(true);

    unlinkSync(target);
  });
});

describe('listen argument validation branches (in-process)', () => {
  let io: Captured;

  beforeEach(() => {
    io = captureOutput();
  });

  afterEach(() => {
    io.restore();
  });

  test('rejects a non-numeric --limit', async () => {
    const code = await runListenCommand([VALID_ADDRESS, '--limit', 'abc']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_ARGUMENT');
    expect(parsed.error).toContain('--limit');
  });

  test('rejects a non-numeric --poll-interval', async () => {
    const code = await runListenCommand([VALID_ADDRESS, '--poll-interval', 'abc']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_ARGUMENT');
    expect(parsed.error).toContain('--poll-interval');
  });

  test('rejects a non-numeric --rate-limit', async () => {
    const code = await runListenCommand([VALID_ADDRESS, '--rate-limit', 'abc']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_ARGUMENT');
    expect(parsed.error).toContain('--rate-limit');
  });

  test('rejects a non-HTTPS horizon URL in live mode', async () => {
    const code = await runListenCommand([VALID_ADDRESS, '--horizon-url', 'http://evil.example.com']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_CONFIG');
    expect(parsed.error).toContain('HTTPS');
  });

  test('emits a single simulated event when --limit 1', async () => {
    const code = await runListenCommand([VALID_ADDRESS, '--simulate', '--limit', '1']);
    expect(code).toBe(0);
    const lines = io.stdout.trim().split('\n').filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe('inbound_burn_detected');
    expect(io.stderr).toContain('Stream ended after 1 events');
  });
});

describe('verify validation branches (in-process)', () => {
  let io: Captured;

  beforeEach(() => {
    io = captureOutput();
  });

  afterEach(() => {
    io.restore();
    jest.restoreAllMocks();
  });

  test('rejects a tx hash without the 0x prefix', async () => {
    const code = await runVerifyCommand(['ab'.repeat(32)]);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_HASH');
  });

  test('rejects a tx hash that is too short', async () => {
    const code = await runVerifyCommand(['0xdeadbeef']);
    expect(code).toBe(1);
    expect(JSON.parse(io.stdout).code).toBe('INVALID_HASH');
  });

  test('rejects an unsupported source domain', async () => {
    const code = await runVerifyCommand([VALID_HASH, '--source-domain', '9999']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_DOMAIN');
    expect(parsed.remediation).toContain('sourceDomain');
  });

  test('rejects a non-HTTPS base URL', async () => {
    const code = await runVerifyCommand([VALID_HASH, '--base-url', 'http://evil.example.com']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('INVALID_CONFIG');
    expect(parsed.error).toContain('HTTPS');
  });

  test('accepts --testnet and polls the default source domain', async () => {
    let baseUrlSeen: string | undefined;
    const poll = jest
      .spyOn(AttestationClient.prototype, 'pollAttestationByTx')
      .mockImplementation(function (this: { baseUrl?: string }) {
        baseUrlSeen = this.baseUrl;
        return Promise.resolve({
          status: 'complete',
          attestation: '0x' + 'cd'.repeat(70),
          message: '0x' + 'ab'.repeat(40),
        }) as never;
      });
    jest.spyOn(AttestationClient.prototype, 'verifyAttestation').mockReturnValue(true);

    const code = await runVerifyCommand([VALID_HASH, '--testnet']);
    expect(code).toBe(0);
    expect(baseUrlSeen).toBe('https://iris-api-sandbox.circle.com');

    const parsed = JSON.parse(io.stdout);
    expect(parsed.status).toBe('complete');
    expect(parsed.attested).toBe(true);
    expect(poll).toHaveBeenCalledWith(0, VALID_HASH, expect.any(Function));
  });

  test('reports a generic error when polling throws a non-SDK error', async () => {
    jest
      .spyOn(AttestationClient.prototype, 'pollAttestationByTx')
      .mockRejectedValue(new Error('socket hang up'));

    const code = await runVerifyCommand([VALID_HASH, '--base-url', 'http://127.0.0.1:1', '--max-retries', '1']);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdout);
    expect(parsed.code).toBe('VERIFY_FAILED');
    expect(parsed.error).toBe('socket hang up');
    expect(parsed.remediation).toContain('Circle Iris');
  });
});
