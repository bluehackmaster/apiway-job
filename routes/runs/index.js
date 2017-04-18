var express = require('express');
var jwt = require('jsonwebtoken');
var spawn = require('child_process').spawn
var async = require('async')
var build = require('./build')
var router = express.Router();

/* GET runs listing. */
router.get('/', function(req, res, next) {
    res.send('respond with a resource');
});

/* POST runs listing. */
router.post('/', function(req, res, next) {
    console.log(req.body);

    build.runBuild(req.body, function(error) {
        console.error(error);
    });


    res.status(200).json(req.body);


});


module.exports = router;
