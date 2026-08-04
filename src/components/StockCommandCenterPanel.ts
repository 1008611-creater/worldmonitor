import { Panel } from './Panel';
import type { MarketData } from '@/types';
import { MARKET_SYMBOLS } from '@/config';
import {
  getMarketWatchlistEntries,
  setMarketWatchlistEntries,
  type MarketWatchlistEntry,
} from '@/services/market-watchlist';
import { createWatchlistButton } from './watchlist-modal';
import { escapeHtml, unsafeRawHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import {
  getCrossedStockAlertRules,
  getStockPriceAlert,
  removeStockPriceAlert,
  setStockPriceAlert,
  type StockPriceAlert,
} from '@/services/stock-alerts';

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return value >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value.toFixed(2);
}

function formatChange(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function normalizeSymbol(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

/**
 * Finance-first entry point that reuses the existing market refresh pipeline.
 * Deep analysis and the earnings calendar remain separate panels; this panel
 * gives stock users a clear first action without duplicating those services.
 */
export class StockCommandCenterPanel extends Panel {
  private latestMarkets: MarketData[] = [];
  private previousQuotes = new Map<string, { price: number | null; change: number | null }>();
  private alertStatus = '';
  private notificationRequestInFlight = false;

  constructor() {
    super({
      id: 'stock-command-center',
      title: '股票工作台',
      className: 'panel-wide stock-command-center-panel',
      defaultRowSpan: 2,
      infoTooltip: '股票工作台汇总自选股与核心市场行情。深度分析和财报日历使用现有金融数据服务。',
    });
    this.header.appendChild(createWatchlistButton('编辑自选'));
    this.showLoading();
  }

  public renderMarkets(data: MarketData[]): void {
    const messages: string[] = [];
    for (const item of data) {
      const symbol = normalizeSymbol(item.symbol);
      const alert = getStockPriceAlert(symbol);
      const crossed = alert
        ? getCrossedStockAlertRules(this.previousQuotes.get(symbol), {
          price: item.price,
          change: item.change,
        }, alert)
        : [];
      if (crossed.length > 0) {
        messages.push(`${item.display || item.symbol}: ${crossed.join('，')}`);
        this.notifyBrowser(`${item.display || item.symbol} 股票提醒`, crossed.join('，'));
      }
    }
    this.previousQuotes = new Map(data.map((item) => [normalizeSymbol(item.symbol), {
      price: item.price,
      change: item.change,
    }]));
    this.latestMarkets = data;
    if (messages.length > 0) this.alertStatus = messages.join('；');
    if (data.length === 0) {
      this.setDataBadge('unavailable');
      this.showRetrying('暂时没有可用行情');
      return;
    }

    this.setDataBadge('live', `${data.length} 个标的`);
    this.setSafeContent(unsafeRawHtml(this.renderContent(), 'stock command center markup'));
    this.bindInteractions();
  }

  private getDisplayMarkets(): MarketData[] {
    const watchlist = getMarketWatchlistEntries();
    const watchSymbols = new Set(watchlist.map((entry) => normalizeSymbol(entry.symbol)));
    const watched = this.latestMarkets.filter((item) => watchSymbols.has(normalizeSymbol(item.symbol)));
    const rest = this.latestMarkets.filter((item) => !watchSymbols.has(normalizeSymbol(item.symbol)));

    if (watchlist.length === 0) {
      const preferred = new Set(MARKET_SYMBOLS.slice(0, 12).map((item) => normalizeSymbol(item.symbol)));
      return this.latestMarkets.filter((item) => preferred.has(normalizeSymbol(item.symbol))).slice(0, 12);
    }

    return [...watched, ...rest].slice(0, 12);
  }

  private renderContent(): string {
    const entries = getMarketWatchlistEntries();
    const markets = this.getDisplayMarkets();
    const validChanges = this.latestMarkets.filter((item) => item.change != null && Number.isFinite(item.change));
    const leader = [...validChanges].sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))[0];
    const laggard = [...validChanges].sort((a, b) => (a.change ?? Infinity) - (b.change ?? Infinity))[0];
    const watchedLabel = entries.length > 0 ? `${entries.length} 只自选股` : '尚未设置自选股';

    return `
      <div class="stock-command-center">
        <div class="stock-command-center__topline">
          <div>
            <div class="stock-command-center__eyebrow">今日市场</div>
            <h3 class="stock-command-center__title">${escapeHtml(watchedLabel)}</h3>
            <div class="stock-command-center__hint">先看行情，再进入个股分析或财报日历。</div>
          </div>
          <form class="stock-command-center__search" data-stock-command-search>
            <label class="wm-visually-hidden" for="stockCommandSymbol">输入股票代码</label>
            <input id="stockCommandSymbol" name="symbol" autocomplete="off" maxlength="20" aria-label="输入股票代码" placeholder="输入代码，如 NVDA" />
            <button type="submit">加入自选</button>
          </form>
        </div>

        <div class="stock-command-center__stats" aria-label="市场摘要">
          <div><span>跟踪标的</span><strong>${escapeHtml(String(this.latestMarkets.length))}</strong></div>
          <div><span>今日最强</span><strong>${leader ? `${escapeHtml(leader.display || leader.symbol)} ${escapeHtml(formatChange(leader.change))}` : '--'}</strong></div>
          <div><span>今日最弱</span><strong>${laggard ? `${escapeHtml(laggard.display || laggard.symbol)} ${escapeHtml(formatChange(laggard.change))}` : '--'}</strong></div>
        </div>

        <div class="stock-command-center__grid">
          ${markets.map((item) => {
            const change = item.change ?? null;
            const tone = change != null && change >= 0 ? 'positive' : 'negative';
            const symbol = item.display || item.symbol;
            return `
              <article class="stock-command-card">
                <div class="stock-command-card__identity">
                  <strong>${escapeHtml(symbol)}</strong>
                  <span>${escapeHtml(item.name || item.symbol)}</span>
                </div>
                <div class="stock-command-card__quote">
                  <strong>${escapeHtml(formatPrice(item.price))}</strong>
                  <span class="stock-command-card__change stock-command-card__change--${tone}">${escapeHtml(formatChange(change))}</span>
                </div>
                <button type="button" class="stock-command-card__action" data-stock-analysis="${escapeAttr(item.symbol)}">深度分析</button>
                <button type="button" class="stock-command-card__alert" data-stock-alert="${escapeAttr(item.symbol)}">${getStockPriceAlert(item.symbol) ? '修改提醒' : '设置提醒'}</button>
              </article>`;
          }).join('')}
        </div>

        <div class="stock-command-center__actions">
          <button type="button" data-stock-panel="stock-analysis">打开股票分析</button>
          <button type="button" data-stock-panel="earnings-calendar">查看财报日历</button>
          <button type="button" data-stock-alert-request ${this.notificationRequestInFlight ? 'disabled' : ''}>${this.notificationRequestInFlight ? '请求通知权限…' : '启用浏览器通知'}</button>
        </div>
        <div class="stock-command-center__status" data-stock-command-status role="status" aria-live="polite">${escapeHtml(this.alertStatus)}</div>
      </div>`;
  }

  private bindInteractions(): void {
    const form = this.content.querySelector<HTMLFormElement>('[data-stock-command-search]');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = form.elements.namedItem('symbol');
      if (!(input instanceof HTMLInputElement)) return;
      const symbol = normalizeSymbol(input.value);
      const status = this.content.querySelector<HTMLElement>('[data-stock-command-status]');
      if (!symbol || !/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
        if (status) status.textContent = '请输入有效股票代码';
        return;
      }

      const existing = getMarketWatchlistEntries();
      if (existing.some((entry) => normalizeSymbol(entry.symbol) === symbol)) {
        if (status) status.textContent = `${symbol} 已在自选股中`;
        return;
      }

      const seed = MARKET_SYMBOLS.find((item) => normalizeSymbol(item.symbol) === symbol);
      const entry: MarketWatchlistEntry = {
        symbol,
        ...(seed?.name ? { name: seed.name } : {}),
        ...(seed?.display ? { display: seed.display } : {}),
      };
      setMarketWatchlistEntries([...existing, entry]);
      input.value = '';
      if (status) status.textContent = `${symbol} 已加入自选，行情正在刷新`;
    });

    this.content.querySelectorAll<HTMLButtonElement>('[data-stock-panel]').forEach((button) => {
      button.addEventListener('click', () => this.revealPanel(button.dataset.stockPanel || ''));
    });

    this.content.querySelectorAll<HTMLButtonElement>('[data-stock-analysis]').forEach((button) => {
      button.addEventListener('click', () => this.revealPanel('stock-analysis'));
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-stock-alert]').forEach((button) => {
      button.addEventListener('click', () => this.openAlertEditor(button.dataset.stockAlert || '', button));
    });
    this.content.querySelector<HTMLButtonElement>('[data-stock-alert-request]')?.addEventListener('click', () => {
      void this.requestBrowserNotification();
    });
  }

  private notifyBrowser(title: string, body: string): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body, tag: 'worldmonitor-stock-alert' });
  }

  private async requestBrowserNotification(): Promise<void> {
    if (this.notificationRequestInFlight) return;
    this.notificationRequestInFlight = true;
    this.alertStatus = '正在请求浏览器通知权限…';
    this.renderMarkets(this.latestMarkets);
    if (typeof Notification === 'undefined') {
      this.alertStatus = '当前浏览器不支持通知';
      this.notificationRequestInFlight = false;
      this.renderMarkets(this.latestMarkets);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      this.alertStatus = permission === 'granted' ? '浏览器通知已启用' : '通知权限未开启，页面内提醒仍会显示';
    } catch {
      this.alertStatus = '通知权限请求失败，页面内提醒仍会显示';
    } finally {
      this.notificationRequestInFlight = false;
      this.renderMarkets(this.latestMarkets);
    }
  }

  private openAlertEditor(symbol: string, trigger?: HTMLButtonElement): void {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    if (document.querySelector('.stock-alert-modal')) return;
    const existing = getStockPriceAlert(normalized);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'stock-alert-title');
    overlay.setAttribute('aria-describedby', 'stock-alert-form-hint');
    const current = this.latestMarkets.find((item) => normalizeSymbol(item.symbol) === normalized);
    const previouslyFocused = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let closed = false;
    const restoreFocus = () => {
      queueMicrotask(() => {
        if (previouslyFocused && document.contains(previouslyFocused)) {
          previouslyFocused.focus();
          return;
        }
        this.content.querySelector<HTMLButtonElement>(`[data-stock-alert="${CSS.escape(normalized)}"]`)?.focus();
      });
    };
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      restoreFocus();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!focusable.includes(active as HTMLElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    setTrustedHtml(overlay, trustedHtml(`
      <div class="modal stock-alert-modal">
        <div class="modal-header"><h2 id="stock-alert-title" class="modal-title">${escapeHtml(normalized)} 价格提醒</h2><button class="modal-close" type="button" aria-label="关闭">×</button></div>
        <form class="stock-alert-form" novalidate>
          <div class="stock-alert-form__quote">当前价格：${escapeHtml(formatPrice(current?.price ?? null))}</div>
          <div class="stock-alert-form__error" data-stock-alert-error role="alert" aria-live="assertive"></div>
          <label for="stockAlertAbove">价格高于<input id="stockAlertAbove" name="above" type="number" min="0" step="any" value="${existing?.above ?? ''}" placeholder="例如 200" inputmode="decimal" aria-describedby="stock-alert-form-hint"></label>
          <label for="stockAlertBelow">价格低于<input id="stockAlertBelow" name="below" type="number" min="0" step="any" value="${existing?.below ?? ''}" placeholder="例如 150" inputmode="decimal" aria-describedby="stock-alert-form-hint"></label>
          <label for="stockAlertChange">日内涨跌幅达到（%）<input id="stockAlertChange" name="changePercent" type="number" min="0" step="0.1" value="${existing?.changePercent ?? ''}" placeholder="例如 5" inputmode="decimal" aria-describedby="stock-alert-form-hint"></label>
          <div class="stock-alert-form__actions"><button type="button" data-stock-alert-remove>删除提醒</button><button type="button" data-stock-alert-cancel>取消</button><button type="submit">保存提醒</button></div>
          <div id="stock-alert-form-hint" class="stock-alert-form__hint">行情刷新时检查条件；关闭页面后不主动推送。</div>
        </form>
      </div>`, 'stock price alert editor markup'));
    const form = overlay.querySelector<HTMLFormElement>('form');
    const error = overlay.querySelector<HTMLElement>('[data-stock-alert-error]');
    const inputs = ['above', 'below', 'changePercent']
      .map((name) => form?.elements.namedItem(name))
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    const clearValidation = () => {
      if (error) error.textContent = '';
      inputs.forEach((input) => input.removeAttribute('aria-invalid'));
    };
    const showValidationError = (message: string, invalidInputs: HTMLInputElement[]) => {
      if (error) error.textContent = message;
      invalidInputs.forEach((input) => input.setAttribute('aria-invalid', 'true'));
      invalidInputs[0]?.focus();
    };
    inputs.forEach((input) => input.addEventListener('input', clearValidation));
    overlay.querySelector<HTMLButtonElement>('.modal-close')?.addEventListener('click', close);
    overlay.querySelector<HTMLButtonElement>('[data-stock-alert-cancel]')?.addEventListener('click', close);
    overlay.querySelector<HTMLButtonElement>('[data-stock-alert-remove]')?.addEventListener('click', () => {
      removeStockPriceAlert(normalized);
      this.alertStatus = `${normalized} 提醒已删除`;
      close();
      this.renderMarkets(this.latestMarkets);
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      clearValidation();
      const readValue = (name: string): { value?: number; invalid: boolean; input: HTMLInputElement | null } => {
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        const raw = input?.value.trim() ?? '';
        if (!raw) return { invalid: false, input };
        const parsed = Number(raw);
        return { value: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined, invalid: !Number.isFinite(parsed) || parsed <= 0, input };
      };
      const aboveResult = readValue('above');
      const belowResult = readValue('below');
      const changeResult = readValue('changePercent');
      const invalidInputs = [aboveResult, belowResult, changeResult].filter((result) => result.invalid).map((result) => result.input).filter((input): input is HTMLInputElement => input !== null);
      if (invalidInputs.length > 0) {
        showValidationError('提醒条件必须是大于 0 的数字，请检查输入。', invalidInputs);
        return;
      }
      if (aboveResult.value !== undefined && belowResult.value !== undefined && aboveResult.value <= belowResult.value) {
        showValidationError('“价格高于”必须大于“价格低于”。', [aboveResult.input, belowResult.input].filter((input): input is HTMLInputElement => input !== null));
        return;
      }
      const alert: StockPriceAlert = { symbol: normalized, enabled: true };
      const above = aboveResult.value;
      const below = belowResult.value;
      const changePercent = changeResult.value;
      if (above !== undefined) alert.above = above;
      if (below !== undefined) alert.below = below;
      if (changePercent !== undefined) alert.changePercent = changePercent;
      if (above === undefined && below === undefined && changePercent === undefined) {
        showValidationError('至少填写一个提醒条件，再保存提醒。', [inputs[0]!]);
        return;
      }
      setStockPriceAlert(alert);
      this.alertStatus = `${normalized} 提醒已保存`;
      close();
      this.renderMarkets(this.latestMarkets);
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown, true);
    requestAnimationFrame(() => overlay.querySelector<HTMLInputElement>('#stockAlertAbove')?.focus());
  }

  private revealPanel(panelId: string): void {
    if (!panelId) return;
    window.dispatchEvent(new CustomEvent('enable-panel', { detail: { panelId } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('wm:reveal-panel', { detail: { panelId } }));
      document.querySelector(`[data-panel="${panelId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }
}
