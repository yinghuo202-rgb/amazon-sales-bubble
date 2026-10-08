const path = require("node:path");
module.exports = {
  ...require("./package.json").build,
  electronDist: path.join(__dirname, "node_modules", "electron", "dist"),
  compression: "normal",
  win: { target: "portable", signAndEditExecutable: false },
};
