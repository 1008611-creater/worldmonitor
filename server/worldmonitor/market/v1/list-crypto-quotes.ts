/**
 * RPC: ListCryptoQuotes -- reads seeded crypto data from Railway seed cache.
 * Local development can read CoinGecko/CoinPaprika directly when the cache is empty.
 */

import type {
  ServerContext,
  ListCryptoQuotesRequest,
  ListCryptoQuotesResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { CRYPTO_META, fetchCryptoMarkets, fetchFinnhubQuote, parseStringArray } from './_shared';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:crypto:v1';
const DIRECT_FALLBACK_MAX_IDS = 10;

const SYMBOL_TO_ID = new Map(Object.entries(CRYPTO_META).map(([id, m]) => [m.symbol, id]));
const FINNHUB_SYMBOLS = new Map(Object.entries(CRYPTO_META).map(([id, metadata]) => [id, `BINANCE:${metadata.symbol}USDT`]));

function isLocalDirectFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
}

async function fetchLocalCryptoFallback(ids: string[]): Promise<ListCryptoQuotesResponse | null> {
  if (!isLocalDirectFallbackEnabled()) return null;

  const candidates = (ids.length > 0 ? ids : Object.keys(CRYPTO_META)).slice(0, DIRECT_FALLBACK_MAX_IDS);
  if (candidates.length === 0) return null;

  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey) {
    const results = await Promise.all(candidates.map(async (id) => {
      const finnhubSymbol = FINNHUB_SYMBOLS.get(id);
      if (!finnhubSymbol) return null;
      const quote = await fetchFinnhubQuote(finnhubSymbol, finnhubKey);
      const metadata = CRYPTO_META[id];
      if (!quote || !metadata) return null;
      return {
        name: metadata.name,
        symbol: metadata.symbol,
        price: quote.price,
        change: quote.changePercent,
        change7d: 0,
        sparkline: [],
      } satisfies CryptoQuote;
    }));
    const finnhubQuotes = results.filter((quote): quote is NonNullable<typeof quote> => quote !== null);
    if (finnhubQuotes.length > 0) return { quotes: finnhubQuotes };
  }

  try {
    const markets = await fetchCryptoMarkets(candidates);
    const quotes: CryptoQuote[] = markets.flatMap((market) => {
      const metadata = CRYPTO_META[market.id];
      if (!metadata || !Number.isFinite(market.current_price)) return [];
      const change7d = market.price_change_percentage_7d_in_currency;
      return [{
        name: metadata.name,
        symbol: metadata.symbol,
        price: market.current_price,
        change: Number.isFinite(market.price_change_percentage_24h) ? market.price_change_percentage_24h : 0,
        change7d: typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0,
        sparkline: market.sparkline_in_7d?.price?.filter(Number.isFinite) ?? [],
      }];
    });
    return quotes.length > 0 ? { quotes } : null;
  } catch {
    return null;
  }
}

export async function listCryptoQuotes(
  _ctx: ServerContext,
  req: ListCryptoQuotesRequest,
): Promise<ListCryptoQuotesResponse> {
  const parsedIds = parseStringArray(req.ids);
  const ids = parsedIds.length > 0 ? parsedIds : Object.keys(CRYPTO_META);

  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { quotes: CryptoQuote[] } | null;
    if (!seedData?.quotes?.length) return await fetchLocalCryptoFallback(ids) ?? { quotes: [] };

    const allIds = new Set(ids);
    const filtered = allIds.size === 0
      ? seedData.quotes
      : seedData.quotes.filter((q) => allIds.has(SYMBOL_TO_ID.get(q.symbol) ?? ''));

    return { quotes: filtered };
  } catch {
    return { quotes: [] };
  }
}
