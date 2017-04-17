var express = require('express');
var spawn = require('child_process').spawn
var async = require('async')
var config = require('../../utils/config')
var BuildInfo = require('./build').BuildInfo
var router = express.Router();

/* GET runs listing. */
router.get('/', function(req, res, next) {
    res.send('respond with a resource');
});

/* POST runs listing. */
router.post('/', function(req, res, next) {
    console.log(req.body);

    var build = new BuildInfo(req.body)
    build.config = config.initConfig(req.body, build)
    config.initSync(build.config);
    res.status(200).json(req.body);



});


module.exports = router;
