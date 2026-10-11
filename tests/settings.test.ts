import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FONT, fontStack, readSettings } from "../src/settings";

test("nothing stored gives the defaults: typewriter on, dimming off, Scrivener's look and face", () => {
  const settings = readSettings(null);
  assert.equal(settings.typewriter, true);
  assert.equal(settings.dimming, "off");
  assert.equal(settings.paper, "auto");
  assert.equal(settings.font, DEFAULT_FONT);
  assert.equal(settings.wordCount, false);
});

test("a stored value is read, and a wrong one costs only that setting", () => {
  const settings = readSettings({ paper: "grey", font: "", dimming: "purple", typewriter: "yes" });
  assert.equal(settings.paper, "grey");
  assert.equal(readSettings({ paper: "scrivener" }).paper, "auto");
  assert.equal(settings.font, "");
  assert.equal(settings.dimming, "off");
  assert.equal(settings.typewriter, true);
});

test("the setting shows a plain Palatino; the page gets its stand-ins, and any other face as typed", () => {
  assert.equal(fontStack("Palatino"), "Palatino, 'Book Antiqua', 'Palatino Linotype', Georgia, serif");
  assert.equal(fontStack("palatino"), "Palatino, 'Book Antiqua', 'Palatino Linotype', Georgia, serif");
  assert.equal(fontStack("Georgia"), "Georgia");
});
