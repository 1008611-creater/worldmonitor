import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ServerContext } from '../src/generated/server/worldmonitor/market/v1/service_server';
import { listCommodityQuotes } from '../server/worldmonitor/market/v1/list-commodity-quotes.ts';
import { listCryptoQuotes } from '../server/worldmonitor/market/v1/list-crypto-quotes.ts';

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalFinnhubKey = process.env.FINNHUB_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalFinnhubKey === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = originalFinnhubKey;
});

describe('local market fallbacks', () => {
  it('reads a commodity quote from Yahoo when the bootstrap cache is empty', async () => {
    process.env.NODE_ENV = 'development';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        chart: { result: [{
          meta: { regularMarketPrice: 2300, chartPreviousClose: 2280 },
          indicators: { quote: [{ close: [2250, 2280, 2300] }] },
        }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const result = await listCommodityQuotes({} as ServerContext, { symbols: ['GC=F'] });

    assert.deepEqual(result.quotes, [{
      symbol: 'GC=F',
      name: 'Gold',
      display: 'GOLD',
      price: 2300,
      change: 0.8771929824561403,
      sparkline: [2250, 2280, 2300],
    }]);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0]!, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/GC%3DF/);
  });

  it('reads crypto quotes from CoinGecko with 7-day change when the cache is empty', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.FINNHUB_API_KEY;
    let requestedUrl = '';
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify([{
        id: 'bitcoin',
        current_price: 100000,
        price_change_percentage_24h: 1.2,
        price_change_percentage_7d_in_currency: 8.5,
        sparkline_in_7d: { price: [99000, 100000] },
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const result = await listCryptoQuotes({} as ServerContext, { ids: ['bitcoin'] });

    assert.deepEqual(result.quotes, [{
      name: 'Bitcoin',
      symbol: 'BTC',
      price: 100000,
      change: 1.2,
      change7d: 8.5,
      sparkline: [99000, 100000],
    }]);
    assert.match(requestedUrl, /price_change_percentage=24h,7d/);
  });

  it('uses Finnhub for crypto when a local Finnhub key is configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FINNHUB_API_KEY = 'test-key';
    let requestedUrl = '';
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ c: 62500, dp: 1.5, h: 63000, l: 61000, pc: 61500 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await listCryptoQuotes({} as ServerContext, { ids: ['bitcoin'] });

    assert.deepEqual(result.quotes, [{
      name: 'Bitcoin',
      symbol: 'BTC',
      price: 62500,
      change: 1.5,
      change7d: 0,
      sparkline: [],
    }]);
    assert.match(requestedUrl, /finnhub\.io\/api\/v1\/quote\?symbol=BINANCE%3ABTCUSDT/);
  });

  it('does not direct-fetch in production when the caches are empty', async () => {
    process.env.NODE_ENV = 'production';
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const [commodity, crypto] = await Promise.all([
      listCommodityQuotes({} as ServerContext, { symbols: ['GC=F'] }),
      listCryptoQuotes({} as ServerContext, { ids: ['bitcoin'] }),
    ]);

    assert.deepEqual(commodity.quotes, []);
    assert.deepEqual(crypto.quotes, []);
    assert.equal(called, false);
  });
});
