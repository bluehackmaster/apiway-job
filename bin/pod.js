#!/usr/bin/env node
var build = require('../routes/runs/build')

main()

function main () {
  build.runBuild((err, res) => {
  });
}
