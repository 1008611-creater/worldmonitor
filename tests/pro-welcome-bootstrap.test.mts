import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { clearWelcomeRoot } from '../pro-test/src/welcome-root.ts';
import { resolveEffectiveWelcomeContentLanguage } from '../pro-test/src/welcome-language.ts';

const readLocale = (language: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`../pro-test/src/locales/${language}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('welcome bootstrap root clearing', () => {
  it('uses replaceChildren when the browser supports it', () => {
    let replaceChildrenCalls = 0;
    const root = {
      textContent: 'prerendered markup',
      replaceChildren: () => {
        replaceChildrenCalls += 1;
      },
    };

    clearWelcomeRoot(root);

    assert.equal(replaceChildrenCalls, 1);
  });

  it('clears the root with textContent when replaceChildren is unavailable', () => {
    const root = { textContent: 'prerendered markup' };

    clearWelcomeRoot(root);

    assert.equal(root.textContent, '');
  });
});

describe('effective welcome content language', () => {
  const englishWelcome = readLocale('en').welcome;

  it('uses English for real locales that omit or duplicate the English welcome namespace', () => {
    for (const language of ['fr', 'ar', 'fa']) {
      assert.equal(
        resolveEffectiveWelcomeContentLanguage(
          language,
          englishWelcome,
          readLocale(language),
        ),
        'en',
        `${language} should hydrate the truthful English prerender`,
      );
    }
  });

  it('uses the detected locale once it owns genuinely localized welcome copy', () => {
    assert.equal(
      resolveEffectiveWelcomeContentLanguage(
        'fr-FR',
        englishWelcome,
        { welcome: { hero: { headline1: 'Déjà informé.' } } },
      ),
      'fr',
    );
  });
});
