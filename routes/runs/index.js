var express = require('express');
var jwt = require('jsonwebtoken');
var spawn = require('child_process').spawn
var async = require('async')
var build = require('./build')
var router = express.Router();
var Response = require('../../utils/response');
var RESP = require('../../utils/response_values');
var response = new Response();

/* GET runs listing. */
router.get('/', function(req, res, next) {
    res.send('respond with a resource');
});

/* POST runs listing. */
router.post('/', function(req, res, next) {
    console.log(req.body);
    build.runBuild(req.body, (err, data) => {
      if (err) {
        response.responseMessage = err
        res.json(response);
      }
      res.json(data);
    });
});

module.exports = router;
