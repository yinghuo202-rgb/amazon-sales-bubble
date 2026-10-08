module.exports = {
  ...require("./package.json").build,
  compression: "normal",
  win: { target: "portable", signAndEditExecutable: false },
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.business",
    identity: null,
    hardenedRuntime: false,
  },
  dmg: {
    title: "Amazon Sales Bubble",
    backgroundColor: "#f4f7fb",
  },
};
