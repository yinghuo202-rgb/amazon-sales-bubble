// Native window clipping for the transparent floating host.
let api;

function native() {
  if (process.platform !== "win32") return null;
  if (api) return api;
  const k = require("koffi"),
    user = k.load("user32.dll"),
    gdi = k.load("gdi32.dll");
  api = {
    dpi: user.func("uint32 __stdcall GetDpiForWindow(void *window)"),
    region: gdi.func(
      "void * __stdcall CreateRoundRectRgn(int left,int top,int right,int bottom,int width,int height)",
    ),
    setRegion: user.func(
      "int __stdcall SetWindowRgn(void *window,void *region,bool redraw)",
    ),
    deleteRegion: gdi.func("bool __stdcall DeleteObject(void *object)"),
  };
  return api;
}

function hwnd(window) {
  const b = window.getNativeWindowHandle();
  return b.length === 8 ? b.readBigUInt64LE() : BigInt(b.readUInt32LE());
}

function round(window, width, height, diameter = height) {
  if (process.argv.includes("--no-native-clip")) return;
  const a = native();
  if (!a) return;
  const handle = hwnd(window),
    scale = (a.dpi(handle) || 96) / 96,
    h = Math.round(height * scale),
    d = Math.round(diameter * scale),
    region = a.region(0, 0, Math.round(width * scale) + 1, h + 1, d, d);
  if (!a.setRegion(handle, region, true)) a.deleteRegion(region);
}

module.exports = { round };
