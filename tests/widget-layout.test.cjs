const { test } = require("node:test");
const assert = require("node:assert/strict");
const { widgetSize, floatingLayout } = require("../core/widget-layout.cjs");

test("floating host stays fixed while the inner pill owns bounded widths", () => {
  assert.deepEqual(widgetSize("floating", null), { width: 360, height: 100 });
  assert.deepEqual(widgetSize("floating", { type: "ORDER" }, "event"), {
    width: 360,
    height: 100,
  });
  assert.deepEqual(widgetSize("floating", { type: "REVIEW" }, "event"), {
    width: 360,
    height: 100,
  });
});

test("floating position remains in the available display after monitor removal or expansion", () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  for (const saved of [{ x: -1400, y: -100 }, { x: 1900, y: 1030 }, null]) {
    const b = floatingLayout({
      work,
      size: widgetSize("floating", { type: "ORDER" }),
      saved,
    });
    assert.ok(b.x >= 0 && b.y >= 0);
    assert.ok(b.x + b.width <= 1920 && b.y + b.height <= 1040);
  }
  const defaultBounds = floatingLayout({
    work,
    size: widgetSize("floating", null),
    saved: null,
  });
  assert.equal(defaultBounds.x, 1920 - 360 - 24);
  assert.equal(defaultBounds.y, 1040 - 100 - 48);
  const saved = { x: 150, y: 240 };
  assert.deepEqual(
    floatingLayout({ work, size: widgetSize("floating", null), saved }),
    { ...saved, width: 360, height: 100, visible: true, status: "floating" },
  );
});
