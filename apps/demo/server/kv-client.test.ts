// apps/demo/server/kv-client.test.ts
// Regression: the KV client must return raw strings.
//
// Every store in kv.ts `JSON.parse`s the exact string it wrote and guards with
// `typeof raw !== 'string'`. `@upstash/redis` auto-deserializes JSON on `get` by
// default, so those guards reject a valid record and every read returns null: an
// initiate that returned 200 became `NO_INTENT` on the very next status poll.
// The in-memory fakes the other suites use cannot catch this, so the construction
// options are asserted directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ctor } = vi.hoisted(() => ({ ctor: vi.fn() }));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(opts: unknown) {
      ctor(opts);
    }
  },
}));

import { createKvClient } from './kv.js';

describe('createKvClient', () => {
  beforeEach(() => ctor.mockClear());

  it('disables auto-deserialization so get() returns the raw string the stores JSON.parse', () => {
    createKvClient('https://example.upstash.io', 'token');

    expect(ctor).toHaveBeenCalledWith({
      url: 'https://example.upstash.io',
      token: 'token',
      automaticDeserialization: false,
    });
  });
});
