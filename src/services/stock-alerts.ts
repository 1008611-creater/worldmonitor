/**
 * Browser-side price alerts for the finance variant.
 *
 * Rules live in localStorage so they work without another provider or key.
 * The key is part of CLOUD_SYNC_KEYS, which lets signed-in users carry the
 * same alert setup between devices when cloud preference sync is enabled.
 */

export interface StockPriceAlert {
  symbol: string;
  above?: number;
  below?: number;
  changePercent?: number;
  enabled: boolean;
}

const STORAGE_KEY = 'wm-stock-alerts-v1';
const MAX_ALERTS = 50;
const SYMBOL_RE = /^[A-Z][-A-Z0-9&^.=]{0,19}$/;

function normalizeSymbol(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function finitePositive(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function coerceAlert(value: unknown): StockPriceAlert | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const symbol = normalizeSymbol(String(raw.symbol ?? ''));
  if (!SYMBOL_RE.test(symbol)) return null;

  const above = finitePositive(raw.above);
  const below = finitePositive(raw.below);
  const changePercent = finitePositive(raw.changePercent);
  if (above === undefined && below === undefined && changePercent === undefined) return null;

  return {
    symbol,
    ...(above !== undefined ? { above } : {}),
    ...(below !== undefined ? { below } : {}),
    ...(changePercent !== undefined ? { changePercent } : {}),
    enabled: raw.enabled !== false,
  };
}

export function getStockPriceAlerts(): StockPriceAlert[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const alerts: StockPriceAlert[] = [];
    for (const value of parsed) {
      const alert = coerceAlert(value);
      if (!alert || seen.has(alert.symbol)) continue;
      seen.add(alert.symbol);
      alerts.push(alert);
      if (alerts.length >= MAX_ALERTS) break;
    }
    return alerts;
  } catch {
    return [];
  }
}

export function getStockPriceAlert(symbol: string): StockPriceAlert | null {
  const normalized = normalizeSymbol(symbol);
  return getStockPriceAlerts().find((alert) => alert.symbol === normalized) ?? null;
}

export function setStockPriceAlert(alert: StockPriceAlert): void {
  const normalized = coerceAlert(alert);
  if (!normalized) return;
  const next = getStockPriceAlerts().filter((item) => item.symbol !== normalized.symbol);
  next.push(normalized);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-MAX_ALERTS)));
  } catch {
    // Ignore storage failures; the live dashboard remains usable.
  }
  window.dispatchEvent(new CustomEvent('wm-stock-alerts-changed', { detail: { alerts: next } }));
}

export function removeStockPriceAlert(symbol: string): void {
  const normalized = normalizeSymbol(symbol);
  const next = getStockPriceAlerts().filter((item) => item.symbol !== normalized);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; the live dashboard remains usable.
  }
  window.dispatchEvent(new CustomEvent('wm-stock-alerts-changed', { detail: { alerts: next } }));
}

export interface StockQuoteForAlert {
  price: number | null;
  change: number | null;
}

/** Returns the rules crossed between two consecutive market refreshes. */
export function getCrossedStockAlertRules(
  previous: StockQuoteForAlert | undefined,
  current: StockQuoteForAlert,
  alert: StockPriceAlert,
): string[] {
  if (!alert.enabled || !previous) return [];
  const messages: string[] = [];
  const previousPrice = previous.price;
  const currentPrice = current.price;
  if (alert.above !== undefined && previousPrice != null && currentPrice != null
    && previousPrice < alert.above && currentPrice >= alert.above) {
    messages.push(`价格已上穿 ${alert.above}`);
  }
  if (alert.below !== undefined && previousPrice != null && currentPrice != null
    && previousPrice > alert.below && currentPrice <= alert.below) {
    messages.push(`价格已下穿 ${alert.below}`);
  }
  if (alert.changePercent !== undefined && previous.change != null && current.change != null
    && Math.abs(previous.change) < alert.changePercent && Math.abs(current.change) >= alert.changePercent) {
    messages.push(`日内涨跌幅达到 ${alert.changePercent}%`);
  }
  return messages;
}
