/**
 * Locks the duplicate-subscription (409) dialog copy.
 *
 * Two shapes share one dialog since Pro Business joined the `pro` billing
 * family (KTD4): the long-standing "you're already subscribed, manage it in
 * the portal" line, and the guided upgrade copy for the ONE pairing the
 * portal cannot perform — Pro → Pro Business are separate Dodo products, not
 * an updatable collection, so the buyer has to cancel and re-buy. That copy
 * carries four load-bearing facts (current plan, the two steps, what happens
 * to the term they already paid for, a support contact); this file is what
 * stops any of them being dropped in a future copy edit.
 *
 * Pure-function test: the DOM rendering is the shared checkout-dialog-factory
 * scaffold, covered by parity with the sibling dialogs, and the product-id →
 * `isProBusinessUpgrade` resolution lives in checkout.ts (lazy products chunk).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildDuplicateSubscriptionBody } from '../src/services/checkout-duplicate-dialog.ts';

describe('buildDuplicateSubscriptionBody', () => {
  it('keeps the generic portal copy for a same-plan-family re-purchase', () => {
    const body = buildDuplicateSubscriptionBody({ planDisplayName: 'Pro Monthly' });
    assert.equal(
      body,
      "Your account already has an active Pro Monthly subscription. Open the billing portal to manage it — you won't be charged twice.",
    );
  });

  it('keeps the generic portal copy when the flag is explicitly false', () => {
    const body = buildDuplicateSubscriptionBody({
      planDisplayName: 'API Starter',
      isProBusinessUpgrade: false,
    });
    assert.ok(body.includes('API Starter'));
    assert.ok(!body.includes('support@worldmonitor.app'));
  });

  it('uses guided upgrade copy for a Pro Business checkout', () => {
    const body = buildDuplicateSubscriptionBody({
      planDisplayName: 'Pro Annual',
      isProBusinessUpgrade: true,
    });
    // Names the plan they already hold.
    assert.ok(body.includes('Pro Annual'));
    // Cancel-then-rebuy steps.
    assert.ok(body.includes('cancel'));
    assert.ok(body.includes('billing portal'));
    assert.ok(body.includes('Pro Business'));
    // What happens to the remaining paid term.
    assert.ok(body.includes("already paid for"));
    assert.ok(body.includes('new billing cycle'));
    // Support contact.
    assert.ok(body.includes('support@worldmonitor.app'));
  });

  it('still produces a coherent sentence with the fallback plan name', () => {
    const body = buildDuplicateSubscriptionBody({
      planDisplayName: 'Pro',
      isProBusinessUpgrade: true,
    });
    assert.ok(body.startsWith('Your account already has an active Pro subscription.'));
  });
});
