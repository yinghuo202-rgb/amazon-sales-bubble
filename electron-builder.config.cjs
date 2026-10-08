module.exports = {
  ...require("./package.json").build,
  compression: "normal",
  win: { target: "portable", signAndEditExecutable: false },
  mac: {
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    category: "public.app-category.business",
  },
  dmg: {
    title: "Amazon Sales Bubble",
    backgroundColor: "#f4f7fb",
  },
};
