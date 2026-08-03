import { SITE_VARIANT } from './variant';

/**
 * Self-hosted deployments can use the complete local dashboard without the
 * hosted WorldMonitor billing gates. Finance builds default to this mode;
 * `VITE_LOCAL_FREE_MODE=false` can explicitly restore the hosted gates.
 */
function readLocalFreeMode(): boolean {
  const configured = import.meta.env?.VITE_LOCAL_FREE_MODE;
  if (configured !== undefined) {
    return configured === '1' || configured === 'true';
  }
  return SITE_VARIANT === 'finance';
}

export const SELF_HOSTED_FREE_MODE = readLocalFreeMode();
