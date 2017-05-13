var path = require('path')
var EventEmitter = require('events')
var async = require('async')
var db = require('../../db')
var utils = require('../../utils')
var log = require('../../utils/log')
var config = require('../../utils/config')
var env = require('../../utils/env')
var github = require('../../sources/github')
var ApiWay = require('apiway.js')
var spawn = require('child_process').spawn

exports.runBuild = function(buildData, cb) {
    addInstance(buildData, cb)
    // cloneAndBuild(info, cb)
}

function addInstance (buildData, cb) {
  let apiway = new ApiWay({});
  let instance = apiway.getInstance();
  let data = {
    projectId: buildData.projectId
  };

  instance.addInstance(data)
    .then(response => {
      console.log(response.data)
      var info = new BuildInfo(buildData);
      info.config = config.initConfig(buildData, info)
      config.initSync(info.config);
      cb(0, response.data)
      cloneAndBuild(info)
    }).catch((err) => {
      console.log(err)
      cb(err, response.data)
  })
}

function BuildInfo(buildData) {
    this.startedAt = new Date()
    this.endedAt = null

    this.status = 'pending'
    this.statusEmitter = new EventEmitter()

    // Any async functions to run on 'finish' should be added to this array,
    // and be of the form: function(build, cb)
    this.statusEmitter.finishTasks = []

    this.project = config.FUNCTION_NAME;
    this.buildNum = config.FUNCTION_BUILDNUM || 0;

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

    this.branch = buildData.git_branch || 'master'
    this.cloneRepo = buildData.git_repo_id
    this.cloneUser = buildData.git_user_id
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

        console.log(build);
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

            console.log("before lambdaBuild");
            if (build.config.docker) {
                //dockerBuild(build, done)
            } else {
                lambdaBuild(build, done)
            }
        })
    })
}

function buildDone(build, cb) {

    // Don't update statuses if we're doing a docker build and we launched successfully
    if (!build.error && build.config.docker) return cb()

    log.info(build.error ? `Build #${build.buildNum} failed: ${build.error.message}` :
        `Build #${build.buildNum} successful!`)

    build.endedAt = new Date()
    build.status = build.error ? 'failure' : 'success'
    build.statusEmitter.emit('finish', build)

    var finishTasks = build.statusEmitter.finishTasks.concat(db.finishBuild)

    async.forEach(finishTasks, (task, cb) => task(build, cb), function(taskErr) {
        log.logIfErr(taskErr)
        cb(build.error)
    })
}

function clone(build, cb) {
    console.log("clone");

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

    // No caching of clones for now – can revisit this if we want to – but for now, safer to save space
    var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd, checkoutCmd)
    // var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd)

    // var env = prepareLambdaConfig({}).env
    // var runCmd = (cmd, cb) => runInBash(cmd, {env: env, logCmd: maskCmd(cmd)}, cb)
    var runCmd = (cmd, cb) => runInBash(cmd, {logCmd: maskCmd(cmd)}, cb)

    console.log(cmds.length);

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

function lambdaBuild(build, cb) {

    console.log("lambdaBuild");
    // build.config = prepareLambdaConfig(build.config)

    console.log('cloneDir = ' + build.cloneDir);
    var opts = {
        cwd: build.cloneDir,
        // env: config.resolveEnv(build.config),
    }

    var child_process = require('child_process');
    // console.log(child_process.execSync('find /usr -name npm -type f', {encoding: 'utf-8'}));

    var cmds = ['npm install -d', "./node_modules/mocha/bin/mocha test"];
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
    console.log("runInBash");
    var logCmd = opts.logCmd || cmd
    delete opts.logCmd

    console.log('bok--------1 ' + logCmd);
    log.info(`$ ${logCmd}`)
    var proc = spawn('/bin/bash', ['-c', cmd ], opts)
    proc.stdout.pipe(utils.lineStream(log.info))
    proc.stderr.pipe(utils.lineStream(log.error))
    // proc.on('error', cb)
    proc.on('error', function (err) {
        console.log(err)
        cb(err);
    });

    proc.on('close', function(code) {
        var err
        console.log("bok 1");
        if (code) {
            console.log("bok 2: code = " + code);
            err = new Error(`Command "${logCmd}" failed with code ${code}`)
            err.code = code
            err.logTail = log.getTail()
        }
        cb(err)
    })
}
