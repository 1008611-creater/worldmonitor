/**
 * RPC: ListMarketQuotes -- reads seeded stock/index data from Railway seed cache.
 * All external Finnhub/Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListMarketQuotesRequest,
  ListMarketQuotesResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import stocksConfig from '../../../../shared/stocks.json';
import { fetchFinnhubQuote, parseStringArray } from './_shared';
import { getCachedJson } from '../../../_shared/redis';

const BOOTSTRAP_KEY = 'market:stocks-bootstrap:v1';
const DIRECT_FALLBACK_MAX_SYMBOLS = 12;
const YAHOO_ONLY_SYMBOLS = new Set(stocksConfig.yahooOnly);
const MARKET_METADATA = new Map(stocksConfig.symbols.map((entry) => [entry.symbol, entry]));

function isLocalDirectFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
}

async function fetchLocalFinnhubFallback(symbols: string[]): Promise<ListMarketQuotesResponse | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || !isLocalDirectFallbackEnabled()) return null;

  const requested = symbols.length > 0 ? symbols : stocksConfig.symbols.map((entry) => entry.symbol);
  const candidates = requested
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol && !YAHOO_ONLY_SYMBOLS.has(symbol))
    .slice(0, DIRECT_FALLBACK_MAX_SYMBOLS);
  if (candidates.length === 0) return null;

  const results = await Promise.all(candidates.map(async (symbol) => {
    const quote = await fetchFinnhubQuote(symbol, apiKey);
    if (!quote) return null;
    const metadata = MARKET_METADATA.get(symbol);
    return {
      symbol: quote.symbol,
      name: metadata?.name ?? quote.symbol,
      display: metadata?.display ?? quote.symbol,
      price: quote.price,
      change: quote.changePercent,
      sparkline: [],
    };
  }));

  const quotes = results.filter((quote): quote is NonNullable<typeof quote> => quote !== null);
  if (quotes.length === 0) return null;
  return { quotes, finnhubSkipped: false, skipReason: '', rateLimited: false };
}

export function filterMarketQuotes(
  bootstrap: ListMarketQuotesResponse,
  symbols: string[],
): ListMarketQuotesResponse {
  if (symbols.length === 0) return bootstrap;
  const symbolSet = new Set(symbols);
  return {
    ...bootstrap,
    quotes: bootstrap.quotes.filter((quote) => symbolSet.has(quote.symbol)),
  };
}

export async function listMarketQuotes(
  _ctx: ServerContext,
  req: ListMarketQuotesRequest,
): Promise<ListMarketQuotesResponse> {
  const parsedSymbols = parseStringArray(req.symbols);

  try {
    const bootstrap = await getCachedJson(BOOTSTRAP_KEY, true) as ListMarketQuotesResponse | null;
    if (!bootstrap?.quotes?.length) {
      return await fetchLocalFinnhubFallback(parsedSymbols)
        ?? { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    return filterMarketQuotes(bootstrap, parsedSymbols);
  } catch {
    return { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
  }
}
