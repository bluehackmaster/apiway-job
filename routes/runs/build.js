var path = require('path')
var EventEmitter = require('events')
var async = require('async')
var fs = require('fs')
var moment = require('moment')
var CLI         = require('clui');
var Spinner     = CLI.Spinner;
var db = require('../../db')
var utils = require('../../utils')
var log = require('../../utils/log')
var report = require('../../utils/report')
var config = require('../../utils/config')
var env = require('../../utils/env')
var github = require('../../sources/github')
var ApiWay = require('apiway.js')
var spawn = require('child_process').spawn
let apiway = new ApiWay({});
let instance = apiway.getInstance();

exports.runBuild = function(cb) {
    // console.log('runBuild')
    run(cb)
}

function run(cb) {
  // console.log(process.env)
  let instanceId = process.env.instanceId || '593c039b3270c7000fd7351f'
  // let instanceId = '593c039b3270c7000fd7351f'
  instance.getInstance(instanceId)
    .then(response => {
      // console.log(response.data)
      let buildData = {}
      buildData.instance = response.data.data
      var info = new BuildInfo(buildData);
      info.config = config.initConfig(buildData, info)
      // console.log(info.config)
      config.initSync(info.config);
      cb(0, response.data)
      cloneAndBuild(info)
    }).catch((err) => {
      console.log(err)
      cb(err, response.data)
  })
}

function BuildInfo(buildData) {
  // console.log(buildData)
    this.startedAt = moment().format()
    this.endedAt = null
    this.status = 'pending'
    this.statusEmitter = new EventEmitter()

    // Any async functions to run on 'finish' should be added to this array,
    // and be of the form: function(build, cb)
    this.statusEmitter.finishTasks = [uploadReport]
    this.project = buildData.instance.project.full_name
    this.buildNum = buildData.instance._id
    this.repo = buildData.repo || 'Undefined repository';

    if (buildData.trigger) {
        var triggerPieces = buildData.trigger.split('/')
        this.trigger = buildData.trigger
        this.eventType = triggerPieces[0] == 'pr' ? 'pull_request' : 'push'
        this.prNum = triggerPieces[0] == 'pr' ? +triggerPieces[1] : 0
        this.branch = triggerPieces[0] == 'push' ? triggerPieces[1] : (buildData.branch || 'master')
    } else {
        this.eventType = buildData.eventType
        this.prNum = buildData.prNum
        this.branch = buildData.branch
        this.trigger = this.prNum ? `pr/${this.prNum}` : `push/${this.branch}`
    }

    this.event = buildData.event
    this.isPrivate = buildData.isPrivate
    this.isRebuild = buildData.isRebuild

    this.branch = buildData.branch || 'master'
    this.cloneRepo = buildData.instance.project.name
    this.cloneUser = buildData.instance.project.full_name.split('/')[0]
    this.checkoutBranch = buildData.checkoutBranch || this.branch
    this.commit = buildData.commit
    this.baseCommit = buildData.baseCommit
    this.comment = buildData.comment
    this.user = buildData.user

    this.isFork = this.cloneRepo != this.repo

    this.committers = buildData.committers

    this.config = null
    this.cloneDir = path.join(config.BASE_BUILD_DIR, this.cloneRepo)

    // this.requestId = context.awsRequestId
    // this.logGroupName = context.logGroupName
    // this.logStreamName = context.logStreamName

    this.token = ''
    this.logUrl = ''
    this.lambdaLogUrl = ''
    this.buildDirUrl = ''
    this.error = null
}

function cloneAndBuild(build, cb) {

    clone(build, function(err) {
        if (err) return cb(err)

        // console.log(build);
        // Now that we've cloned the repository we can check for config files
        build.config = config.prepareBuildConfig(build)

        if (!build.config.build) {
            log.info('config.build set to false – not running build')
            return cb()
        }

        db.initBuild(build, function(err, build) {
            if (err) return cb(err)

            log.info('')
            log.info(`Build #${build.buildNum} started...\n`)

            build.logUrl = log.initBuildLog(build)

            log.info(`Build log: ${build.logUrl}\n`)

            if (build.token) {
                github.createClient(build)
            }

            //TODO: To implement slack notification
            // if (build.config.notifications.slack && build.config.secretEnv.SLACK_TOKEN) {
            //     slack.createClient(build.config.secretEnv.SLACK_TOKEN, build.config.notifications.slack, build)
            // }

            //TODO: To implement SNS
            // if (build.config.notifications.sns) {
            //     sns.createClient(build.config.notifications.sns, build)
            // }

            var done = patchUncaughtHandlers(build, cb)

            build.statusEmitter.emit('start', build)

            // TODO: must be a better place to put this?
            build.config.env.LAMBCI_BUILD_NUM = build.buildNum

            // console.log("before podBuild");
            if (build.config.docker) {
                //dockerBuild(build, done)
            } else {
                podBuild(build, done)
            }
        })
    })
}

function buildDone(build, cb) {

    // Don't update statuses if we're doing a docker build and we launched successfully
    if (!build.error && build.config.docker) return cb()

    log.info(build.error ? `Build #${build.buildNum} failed: ${build.error.message}` :
        `Build #${build.buildNum} successful!`)

    build.endedAt = moment().format()
    build.status = build.error ? 'FAIL' : 'PASS'
    build.statusEmitter.emit('finish', build)

    var finishTasks = build.statusEmitter.finishTasks.concat(db.finishBuild)

    async.forEach(finishTasks, (task, cb) => task(build, cb), function(taskErr) {
        log.logIfErr(taskErr)
        cb(build.error)
    })
}

function uploadReport (build) {
  let mochawesomeDir = `${build.cloneDir}/mochawesome-report`
  let assetDir = `${mochawesomeDir}/assets`
  let reportName = `mochawesome`
  let key = `${build.project}/${build.buildNum}`
  let keyJson = `${key}/report.json`
  let keyHtml = `${key}/report.html`
  let s3Url = `https://${build.config.s3Bucket}.s3.amazonaws.com`

  async.parallel([
    function a (cb) {
      report.syncDirS3(build.config.s3Bucket, key + '/assets', assetDir)
        .then(() => {
        console.log('a done')
          cb()
        })
    },
    function b (cb) {
      report.uploadS3(build.config.s3Bucket, keyJson, `${mochawesomeDir}/${reportName}.json`)
        .then(() => {
          console.log('b done')
          cb()
        })
    },
    function c (cb) {
      report.uploadS3(build.config.s3Bucket, keyHtml, `${mochawesomeDir}/${reportName}.html`)
        .then(() => {
          console.log('c done')
          cb()
        })
    }],
    function (err,results) {
      console.log('a b c uploadReport done')
      if(err) {
        console.log(err);
      } else {
        build.reportJson = `${s3Url}/${keyJson}`
        build.reportHtml = `${s3Url}/${keyHtml}`
        updateInstance(build)
        // console.log(results)
      }
    }
  );
}

function updateInstance (build) {
  // console.log(build)
  let data = {
    endTime: moment().unix(),
    status: build.status,
    logUrl: build.logUrl,
    commit: build.commit,
    commitUrl: build.commitUrl,
    reportJson: build.reportJson,
    reportHtml: build.reportHtml
  }
  console.log(data)
  instance.updateInstance(build.config.instance._id, data)
    .then(response => {
      // console.log(response.data)
    }).catch((err) => {
      console.log(err)
  })
}

function clone(build, cb) {
    // console.log("clone");

    // Just double check we're in tmp!
    if (build.cloneDir.indexOf(config.BASE_BUILD_DIR) !== 0) {
        return cb(new Error(`clone directory ${build.cloneDir} not in base directory ${config.BASE_BUILD_DIR}`))
    }

    build.token = build.config.secretEnv.GITHUB_TOKEN

    var cloneUrl = `https://github.com/${build.cloneUser}/${build.cloneRepo}.git`, maskCmd = cmd => cmd
    if (build.isPrivate && build.token) {
        cloneUrl = `https://${build.token}@github.com/${build.cloneUser}/${build.cloneRepo}.git`
        maskCmd = cmd => cmd.replace(new RegExp(build.token, 'g'), 'XXXX')
    }

    var depth = build.isRebuild ? '' : `--depth ${build.config.git.depth}`
    var cloneCmd = `git clone ${depth} ${cloneUrl} -b ${build.checkoutBranch} ${build.cloneDir}`
    // var checkoutCmd = `cd ${build.cloneDir} && git checkout -qf ${build.commit}`
    var checkoutCmd = `cd ${build.cloneDir} && git checkout -qf ${build.branch}`

    // Bit awkward, but we don't want the token written to disk anywhere
    if (build.isPrivate && build.token && !build.config.inheritSecrets) {
        cloneCmd = [
            `mkdir -p ${build.cloneDir}`,
            `cd ${build.cloneDir} && git init && git pull ${depth} ${cloneUrl} ${build.checkoutBranch}`,
        ]
    }
    var saveCommitCmd = `cd ${build.cloneDir} && git rev-parse HEAD > commit`

    // No caching of clones for now – can revisit this if we want to – but for now, safer to save space
    var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd, checkoutCmd, saveCommitCmd)
    // var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd)

    // var env = prepareLambdaConfig({}).env
    // var runCmd = (cmd, cb) => runInBash(cmd, {env: env, logCmd: maskCmd(cmd)}, cb)
    var runCmd = (cmd, cb) => runInBash(cmd, {logCmd: maskCmd(cmd)}, cb)

    // console.log(cmds.length);

    async.forEachSeries(cmds, runCmd, cb)
}

function patchUncaughtHandlers(build, cb) {
    var origListeners = process.listeners('uncaughtException')
    var done = utils.once(function(err) {
        process.removeListener('uncaughtException', done)
        origListeners.forEach(listener => process.on('uncaughtException', listener))
        build.error = err
        buildDone(build, cb)
    })
    process.removeAllListeners('uncaughtException')
    process.on('uncaughtException', done)
    return done
}

function podBuild(build, cb) {

    // console.log("podBuild");
    // build.config = prepareLambdaConfig(build.config)

    // console.log('cloneDir = ' + build.cloneDir);
    var opts = {
        cwd: build.cloneDir,
        // env: config.resolveEnv(build.config),
    }

    var child_process = require('child_process');
    // console.log(child_process.execSync('find /usr -name npm -type f', {encoding: 'utf-8'}));

    var cmds = ['npm install 1>/dev/null', "mocha test --reporter mochawesome"];
    var runCmd = (cmd, cb) => runInBash(cmd, opts, cb)

    async.forEachSeries(cmds, runCmd, cb)
    // runInBash(build.config.cmd, opts, cb)
}

function runInBash(cmd, opts, cb) {
    // Would love to create a pseudo terminal here (pty), but don't have permissions in Lambda
    /*
     var proc = require('pty.js').spawn('/bin/bash', ['-c', config.cmd], {
     name: 'xterm-256color',
     cwd: cloneDir,
     env: env,
     })
     proc.socket.setEncoding(null)
     if (proc.socket._readableState) {
     delete proc.socket._readableState.decoder
     delete proc.socket._readableState.encoding
     }
     */
    var status = new Spinner(`${cmd} ...`);
    status.start();
    var logCmd = opts.logCmd || cmd
    delete opts.logCmd

    log.info(`$ ${logCmd}`)
    var proc = spawn('/bin/bash', ['-c', cmd ], opts)
    proc.stdout.pipe(utils.lineStream(log.info))
    proc.stderr.pipe(utils.lineStream(log.error))
    // proc.on('error', cb)
    proc.on('error', function (err) {
      console.log(err)
      status.stop()
      cb(err);
    });

    proc.on('close', function(code) {
      var err
      if (code) {
          err = new Error(`Command "${logCmd}" failed with code ${code}`)
          err.code = code
          err.logTail = log.getTail()
      }
      status.stop()
      cb(err)
    })
}
