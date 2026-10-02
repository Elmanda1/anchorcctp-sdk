import { getDomainMeta } from '@anchor-cctp/core-sdk';
import { runInitCommand } from '../src/commands/init.js';

jest.mock('@anchor-cctp/core-sdk', () => {
  const actual = jest.requireActual('@anchor-cctp/core-sdk');
  return { ...actual, getDomainMeta: jest.fn(actual.getDomainMeta) };
});

describe('init domain lookup failure', () => {
  test('rethrows an unexpected lookup error instead of reporting INVALID_DOMAIN', async () => {
    const mocked = getDomainMeta as unknown as jest.Mock;
    mocked.mockImplementationOnce(() => {
      throw new TypeError('registry corrupted');
    });

    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runInitCommand(['--domain', '27'])).rejects.toThrow('registry corrupted');

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
