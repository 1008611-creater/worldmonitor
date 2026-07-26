/**
 * Data-export gate (plan 2026-07-25-001, KTD2).
 *
 * Pure decision chain for the dashboard + country-brief data exports, plus the
 * catalog-activation probe that decides whether the gate exists at all.
 *
 * Why a dedicated resolver instead of `hasFeature('dataExport')`: that helper
 * coerces `undefined → false` (src/services/entitlements.ts:163), i.e. it FAILS
 * CLOSED — the exact opposite of what this gate needs. A late, failed or
 * skipped entitlement snapshot must never lock a paying customer out of their
 * own data (post-mortem: src/app/panel-layout.ts:710-735). `hasPremiumAccess()`
 * is equally wrong in the other direction: it is true for every Pro subscriber,
 * and export is a Pro Business takeaway.
 *
 * MUST stay a leaf that only imports the zero-import `billing-state` module: it
 * is unit-tested under `tsx --test` (no jsdom, no Vite globals), and both
 * services and the app layer import it.
 */

import { getBillingGateOverride, type BillingUxState } from './billing-state';

/**
 * Locked-state reasons. Values mirror the `PanelGateReason` string enum in
 * panel-gating.ts (kept as plain strings here so this module stays a leaf —
 * same arrangement as `BillingGateOverride`). panel-gating.ts owns the
 * exhaustive mapping back to the enum.
 */
export type ExportGateLockReason =
  | 'anonymous'
  | 'free_tier'
  | 'payment_on_hold'
  | 'renewal_pending'
  | 'renewal_failed'
  | 'lapsed';

/** The two entitlement fields the chain reads, from a LOADED snapshot. */
export interface ExportGateFeatures {
  tier: number;
  /**
   * Undefined on rows served through the 15-minute server-side entitlement
   * cache, whose staleness check does not key on this field. See the tier >= 2
   * fail-open below.
   */
  dataExport?: boolean;
}

export interface ExportGateInputs {
  /** The served product catalog exposes a purchasable `pro_business` group. */
  gateActive: boolean;
  /** Desktop runtime with WORLDMONITOR_API_KEY configured. */
  desktopKeyPresent: boolean;
  /** Clerk auth still resolving (the boot default — auth-state.ts:19). */
  authPending: boolean;
  signedIn: boolean;
  /** Loaded entitlement features, or null when no snapshot has arrived. */
  features: ExportGateFeatures | null;
  /** Billing UX state, used to refine a generic upgrade denial (#4771). */
  billingState: BillingUxState;
}

export type ExportGateVerdict =
  | {
      locked: false;
      /**
       * True when the entitlement chain WOULD lock but the gate is not active
       * yet. The caller uses this to kick `primeExportGateActivation()` lazily,
       * so entitled users never pay for the catalog probe.
       */
      pendingActivation: boolean;
    }
  | { locked: true; reason: ExportGateLockReason };

/**
 * The entitlement chain on its own, independent of catalog activation.
 * Returns null when the user may export.
 *
 * Order matters — every step above the snapshot check is an "unknown", and an
 * unknown is NEVER locked:
 *   1. desktop API key  → allow (no Clerk session exists on that path)
 *   2. auth pending     → allow (cookie-backed users hydrate up to 4s later)
 *   3. signed out       → LOCK, anonymous (the only affirmative denial we can
 *                         make without an entitlement snapshot)
 *   4. no snapshot      → allow (late / failed / skipped Convex subscription)
 *   5. dataExport true  → allow
 *   6. dataExport undefined AND tier >= 2 → allow (PERMANENT legacy fail-open,
 *      mirroring the apiDailyAllowance precedent; an explicit `false` is never
 *      a stale row, so it still locks)
 *   7. otherwise        → LOCK, refined by billing state so a customer with
 *      stale paid evidence sees "update payment" instead of an upsell.
 */
export function resolveExportLock(input: ExportGateInputs): ExportGateLockReason | null {
  if (input.desktopKeyPresent) return null;
  if (input.authPending) return null;
  if (!input.signedIn) return 'anonymous';

  const features = input.features;
  if (features === null) return null;
  if (features.dataExport === true) return null;
  if (features.dataExport === undefined && features.tier >= 2) return null;

  return getBillingGateOverride(input.billingState) ?? 'free_tier';
}

/**
 * Full verdict: the entitlement chain gated on catalog activation (R10). The
 * takeaway can only bite once Pro Business is actually purchasable, so the two
 * flip together regardless of PR/deploy timing.
 */
export function resolveExportGate(input: ExportGateInputs): ExportGateVerdict {
  const reason = resolveExportLock(input);
  if (reason === null) return { locked: false, pendingActivation: false };
  if (!input.gateActive) return { locked: false, pendingActivation: true };
  return { locked: true, reason };
}

// ---------------------------------------------------------------------------
// Catalog activation probe
// ---------------------------------------------------------------------------

const CATALOG_ENDPOINT = '/api/product-catalog';
const CATALOG_TIMEOUT_MS = 5000;
const PRO_BUSINESS_MARKER = 'probusiness';

/**
 * Identity fields only. Marketing copy (`features`, `description`) is
 * deliberately NOT scanned: a Pro card that upsells "upgrade to Pro Business"
 * must not activate the gate.
 */
const TIER_IDENTITY_FIELDS = ['id', 'group', 'tierGroup', 'planKey', 'localeKey', 'name'] as const;

function normalizeIdentity(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

/**
 * Does a served `/api/product-catalog` payload expose the Pro Business group?
 *
 * The endpoint's tier objects carry no single stable group key across the
 * mirrors (edge fallback vs. Railway relay payload), so every plausible
 * identity field is normalized and matched — `pro_business`, `proBusiness`,
 * `Pro Business` and `pro_business_monthly` all resolve to the same marker.
 */
export function catalogExposesProBusiness(payload: unknown): boolean {
  const tiers = (payload as { tiers?: unknown } | null)?.tiers;
  if (!Array.isArray(tiers)) return false;
  return tiers.some((tier) => {
    if (typeof tier !== 'object' || tier === null) return false;
    const record = tier as Record<string, unknown>;
    return TIER_IDENTITY_FIELDS.some((field) =>
      normalizeIdentity(record[field]).startsWith(PRO_BUSINESS_MARKER),
    );
  });
}

type CatalogFetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

let activationProbe: Promise<boolean> | null = null;
let gateActive = false;

/**
 * Synchronous activation flag. False until the probe resolves positively —
 * including on fetch failure — so the export stays available whenever we
 * cannot prove the tier is purchasable.
 */
export function isExportGateActive(): boolean {
  return gateActive;
}

/**
 * Probe the served catalog once per session. Single-flight: the promise is
 * cached, so concurrent callers share one request.
 *
 * `fetch` is called through an arrow wrapper (never `fetch.bind`) so the
 * desktop runtime's patched global is honoured — see AGENTS.md.
 */
export function primeExportGateActivation(fetchImpl?: CatalogFetch): Promise<boolean> {
  if (activationProbe) return activationProbe;

  const doFetch: CatalogFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  activationProbe = (async () => {
    try {
      const res = await doFetch(CATALOG_ENDPOINT, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
      if (!res.ok) return false;
      return catalogExposesProBusiness(await res.json());
    } catch {
      // Offline, blocked, timed out: the gate stays inactive (fail-open).
      return false;
    }
  })().then((active) => {
    gateActive = active;
    return active;
  });

  return activationProbe;
}

/** Test-only: clears the cached probe and activation flag. */
export function __resetExportGateActivationForTests(): void {
  activationProbe = null;
  gateActive = false;
}
