function widgetSize() {
  // Floating mode uses a fixed transparent host. The inner pill owns all
  // content morphing, so native window bounds never change during events.
  return { width: 360, height: 100 };
}
function floatingLayout({ work, size, saved }) {
  const x = Number.isFinite(saved?.x)
    ? saved.x
    : work.x + work.width - size.width - 24;
  const y = Number.isFinite(saved?.y)
    ? saved.y
    : work.y + work.height - size.height - 48;
  return {
    x: Math.round(
      Math.max(work.x, Math.min(x, work.x + work.width - size.width)),
    ),
    y: Math.round(
      Math.max(work.y, Math.min(y, work.y + work.height - size.height)),
    ),
    ...size,
    visible: true,
    status: "floating",
  };
}
module.exports = { widgetSize, floatingLayout };
