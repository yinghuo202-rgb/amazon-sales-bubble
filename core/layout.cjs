function panelPosition(widget, work, width = 292, height = 234) {
  return {
    x: Math.max(
      work.x,
      Math.min(widget.x + widget.width - width, work.x + work.width - width),
    ),
    y:
      widget.y - height - 10 >= work.y
        ? widget.y - height - 10
        : Math.min(
            work.y + work.height - height,
            widget.y + widget.height + 10,
          ),
    width,
    height,
  };
}

module.exports = { panelPosition };
