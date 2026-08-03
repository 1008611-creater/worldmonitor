/**
 * RPC: ListCommodityQuotes -- reads seeded commodity data from Railway seed cache.
 * Local development can read Yahoo Finance directly when the seed cache is empty.
 */

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import commoditiesConfig from '../../../../shared/commodities.json';
import { fetchYahooQuote, parseStringArray } from './_shared';
import { getCachedJson } from '../../../_shared/redis';

const BOOTSTRAP_KEY = 'market:commodities-bootstrap:v1';
const DIRECT_FALLBACK_MAX_SYMBOLS = 12;
const COMMODITY_METADATA = new Map(commoditiesConfig.commodities.map((entry) => [entry.symbol, entry]));

function isLocalDirectFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
}

async function fetchLocalCommodityFallback(symbols: string[]): Promise<ListCommodityQuotesResponse | null> {
  if (!isLocalDirectFallbackEnabled()) return null;

  const requested = symbols.length > 0 ? symbols : commoditiesConfig.commodities.map((entry) => entry.symbol);
  const candidates = requested
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, DIRECT_FALLBACK_MAX_SYMBOLS);
  if (candidates.length === 0) return null;

  const results = await Promise.all(candidates.map(async (symbol) => {
    const quote = await fetchYahooQuote(symbol);
    if (!quote) return null;
    const metadata = COMMODITY_METADATA.get(symbol);
    return {
      symbol,
      name: metadata?.name ?? symbol,
      display: metadata?.display ?? symbol,
      price: quote.price,
      change: quote.change,
      sparkline: quote.sparkline,
    } satisfies CommodityQuote;
  }));

  const quotes = results.filter((quote): quote is NonNullable<typeof quote> => quote !== null);
  return quotes.length > 0 ? { quotes } : null;
}

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  const symbols = parseStringArray(req.symbols);
  if (!symbols.length) return { quotes: [] };

  try {
    const bootstrap = await getCachedJson(BOOTSTRAP_KEY, true) as ListCommodityQuotesResponse | null;
    if (!bootstrap?.quotes?.length) return await fetchLocalCommodityFallback(symbols) ?? { quotes: [] };

    const symbolSet = new Set(symbols);
    const filtered = bootstrap.quotes.filter((q: CommodityQuote) => symbolSet.has(q.symbol));
    return { quotes: filtered };
  } catch {
    return { quotes: [] };
  }
}
