module.exports = {
  ...require("./package.json").build,
  compression: "normal",
  win: { target: "portable", signAndEditExecutable: false },
  mac: {
    // ZIP packaging avoids macOS disk-image tooling on hosted runners.
    // A DMG can still be requested locally with --mac dmg.
    target: ["zip"],
    category: "public.app-category.business",
    identity: null,
    hardenedRuntime: false,
  },
  dmg: {
    title: "Amazon Sales Bubble",
    backgroundColor: "#f4f7fb",
  },
};
