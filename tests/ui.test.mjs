import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("inline browser script remains valid JavaScript", () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) new Function(source);
});

test("mobile copy controls include automatic and manual fallbacks", () => {
  assert.match(page, /id="copyHeart"/);
  assert.match(page, /function legacyCopyText\(/);
  assert.match(page, /id="heartLinkFallback"/);
  assert.match(page, /Press and hold the selected link, then choose Copy\./);
  assert.doesNotMatch(page, /Clipboard timed out/);
});
