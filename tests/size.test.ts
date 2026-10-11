import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSize, defaultSize, hintText, SIZE_MAX, SIZE_MIN, stepSize } from "../src/size";

test("size steps by one and stops at the bounds", () => {
  assert.equal(stepSize(16, 1), 17);
  assert.equal(stepSize(16, -1), 15);
  assert.equal(stepSize(SIZE_MAX, 1), SIZE_MAX);
  assert.equal(stepSize(SIZE_MIN, -1), SIZE_MIN);
});

test("a size from storage is made sane", () => {
  assert.equal(clampSize(Number.NaN), SIZE_MIN);
  assert.equal(clampSize(400), SIZE_MAX);
  assert.equal(clampSize(17.4), 17);
});

test("the hint names the keys for the platform", () => {
  assert.match(hintText({ isMacOS: true, isMobile: false }), /^⌘ \+ and ⌘ −/);
  assert.match(hintText({ isMacOS: false, isMobile: false }), /^Ctrl \+ and Ctrl −/);
  assert.match(hintText({ isMacOS: false, isMobile: true }), /^Pinch/);
});

test("the default size is one and a half times the editor's on a desk, a little larger than the editor's on a phone", () => {
  assert.equal(defaultSize(16), 24);
  assert.equal(defaultSize(17), 26);
  assert.equal(defaultSize(40), SIZE_MAX);
  assert.equal(defaultSize(16, true), 18);
  assert.equal(defaultSize(17, true), 19);
});
