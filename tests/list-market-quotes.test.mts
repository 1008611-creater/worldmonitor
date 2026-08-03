import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ServerContext } from '../src/generated/server/worldmonitor/market/v1/service_server';
import { listMarketQuotes } from '../server/worldmonitor/market/v1/list-market-quotes.ts';

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalFinnhubKey = process.env.FINNHUB_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalFinnhubKey === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = originalFinnhubKey;
});

describe('local Finnhub market fallback', () => {
  it('reads requested quotes when the bootstrap cache is empty', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FINNHUB_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ c: 180, d: 2.5, dp: 1.41, h: 182, l: 178, o: 179, pc: 177.5, t: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await listMarketQuotes({} as ServerContext, { symbols: ['NVDA'] });

    assert.deepEqual(result.quotes, [{
      symbol: 'NVDA',
      name: 'NVIDIA',
      display: 'NVDA',
      price: 180,
      change: 1.41,
      sparkline: [],
    }]);
    assert.equal(result.finnhubSkipped, false);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0]!, /finnhub\.io\/api\/v1\/quote\?symbol=NVDA/);
  });

  it('does not direct-fetch from production when the bootstrap cache is empty', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FINNHUB_API_KEY = 'test-key';
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await listMarketQuotes({} as ServerContext, { symbols: ['NVDA'] });

    assert.deepEqual(result.quotes, []);
    assert.equal(called, false);
  });
});
