import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { searchLocalSymbols, searchSymbols } from '../src/services/symbol-search.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('local symbol search fallback', () => {
  it('finds a configured US stock by ticker', () => {
    assert.deepEqual(searchLocalSymbols('NVDA')[0], {
      symbol: 'NVDA',
      name: 'NVIDIA',
      display: 'NVDA',
    });
  });

  it('finds a configured China stock by ticker and Chinese alias', () => {
    assert.equal(searchLocalSymbols('600519')[0]?.symbol, '600519.SS');
    assert.equal(searchLocalSymbols('茅台')[0]?.symbol, '600519.SS');
  });

  it('caps results and never invents symbols outside the configured directory', () => {
    const results = searchLocalSymbols('a');
    assert.ok(results.length <= 12);
    assert.ok(results.every((result) => result.symbol.length > 0));
    assert.deepEqual(searchLocalSymbols('NOT-A-REAL-TICKER'), []);
  });

  it('falls back when the API is unavailable', async () => {
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    assert.equal((await searchSymbols('NVDA'))[0]?.symbol, 'NVDA');
  });
});
