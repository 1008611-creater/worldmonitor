/**
 * Client for /api/symbol-search — the watchlist editor's typeahead source.
 *
 * Cancels the in-flight request when a newer query supersedes it, so the
 * dropdown never flashes a stale result set after the user keeps typing.
 */

import type { MarketWatchlistEntry } from '@/services/market-watchlist';
import { MARKET_SYMBOLS } from '@/config/markets';

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  display: string;
}

let _inflight: AbortController | null = null;

const MAX_LOCAL_RESULTS = 12;

// The bundled market directory is deliberately small and curated. It is a
// useful offline search source when Finnhub is not configured, while keeping
// the watchlist limited to symbols the rest of the market pipeline knows.
const LOCAL_SEARCH_ALIASES: Record<string, readonly string[]> = {
  '600519.SS': ['茅台', '贵州茅台'],
  '0700.HK': ['腾讯', '腾讯控股'],
  '1211.HK': ['比亚迪'],
  '300750.SZ': ['宁德时代'],
  '688981.SS': ['中芯国际'],
};

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/** Search the bundled, real market directory without requiring an API key. */
export function searchLocalSymbols(query: string): SymbolSearchResult[] {
  const q = normalizeSearchText(query);
  if (!q) return [];

  return MARKET_SYMBOLS
    .map((entry, index) => {
      const fields = [
        entry.symbol,
        entry.display,
        entry.name,
        ...(LOCAL_SEARCH_ALIASES[entry.symbol] ?? []),
      ].map(normalizeSearchText);
      const startsWith = fields.some((field) => field.startsWith(q));
      const includes = fields.some((field) => field.includes(q));
      return {
        entry,
        index,
        score: startsWith ? 0 : includes ? 1 : 2,
      };
    })
    .filter((candidate) => candidate.score < 2)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_LOCAL_RESULTS)
    .map(({ entry }) => ({
      symbol: entry.symbol,
      name: entry.name,
      display: entry.display,
    }));
}

/**
 * Search stocks by ticker or company name. Returns [] for an empty query, a
 * superseded (aborted) request, or any failure. Network results are
 * supplemented by the bundled market directory so watchlist setup remains
 * useful without Finnhub credentials.
 */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const localResults = () => searchLocalSymbols(q);

  // Supersede any in-flight search — the user has typed more since.
  _inflight?.abort();
  const controller = new AbortController();
  _inflight = controller;

  try {
    const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return localResults();
    const data = (await res.json()) as { results?: SymbolSearchResult[] };
    return Array.isArray(data.results) && data.results.length > 0 ? data.results : localResults();
  } catch (err) {
    // AbortError = superseded by a newer query; do not surface stale local
    // matches. Other failures fall back to the bundled directory so the
    // editor remains useful offline.
    if (err instanceof Error && err.name === 'AbortError') return [];
    void err;
    return localResults();
  } finally {
    if (_inflight === controller) _inflight = null;
  }
}

/** A resolved search result is directly usable as a watchlist entry. */
export function toWatchlistEntry(r: SymbolSearchResult): MarketWatchlistEntry {
  return { symbol: r.symbol, name: r.name, display: r.display };
}
