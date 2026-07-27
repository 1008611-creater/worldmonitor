import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const welcomeHtml = () => readFileSync(new URL('../public/pro/welcome.html', import.meta.url), 'utf8');

test('built welcome page ships the real hero in #root before JavaScript', () => {
  const html = welcomeHtml();
  const rootMatch = html.match(/<div id="root"(?<attrs>[^>]*)>(?<content>[\s\S]*?)<\/body>/);
  assert.ok(rootMatch?.groups, 'welcome page should contain #root before body close');

  const { attrs, content } = rootMatch.groups;
  const rootContent = content.split('<noscript>')[0];
  assert.match(attrs, /data-wm-prerendered="welcome"/);
  assert.match(attrs, /data-wm-prerender-lang="en"/);
  assert.doesNotMatch(rootContent, /id="seo-prerender"/);
  assert.equal([...rootContent.matchAll(/<h1\b/g)].length, 1);
  assert.match(rootContent, /<nav[\s>]/);
  assert.match(rootContent, /By the time it&#x27;s news,[\s\S]*you already knew\./);
  assert.match(rootContent, /Launch the dashboard/);
  assert.match(rootContent, /Open source · AGPL-3\.0/);
  assert.match(rootContent, /href="\/blog\/posts\/worldmonitor-is-not-palantir\/"/);
  assert.match(rootContent, /WorldMonitor is not an open-source Palantir/);
  assert.match(rootContent, /Map layers/);
  const headlineIndex = rootContent.indexOf('By the time it&#x27;s news,');
  assert.ok(headlineIndex > 0, 'welcome headline should be in the prerendered root');
  const heroSection = rootContent.slice(0, rootContent.indexOf('<section class="py-16'));
  assert.doesNotMatch(heroSection, /opacity:0/);
  assert.match(rootContent, /<img[^>]+src="\/pro\/assets\/worldmonitor-7-mar-2026-[^"]+\.jpg"[^>]+fetchPriority="high"/);
});
