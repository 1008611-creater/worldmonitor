/**
 * Billing override for the user's own deployment. This is intentionally an
 * environment-only switch: it is never exposed to the browser and it does
 * not alter rate limits or provider credentials.
 */
export function isSelfHostedFreeMode(): boolean {
  const configured = process.env.WORLDMONITOR_LOCAL_FREE_MODE
    ?? process.env.VITE_LOCAL_FREE_MODE;
  if (configured !== undefined) {
    return configured === '1' || configured === 'true';
  }
  return process.env.VITE_VARIANT === 'finance';
}
