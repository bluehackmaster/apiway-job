#!/usr/bin/env node
var build = require('../routes/runs/build')

main()

function main () {
  let data = {
    projectId: "59173df991c95c06396593e6",
    git_user_id: "ApiWay",
    git_branch : "master",
    git_repo_id: "Kiosk-API-test"
  }

  build.runBuild(data, (err, res) => {
  });
}
