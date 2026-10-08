module.exports = {
  ...require("./package.json").build,
  compression: "normal",
  win: { target: "portable", signAndEditExecutable: false },
};
