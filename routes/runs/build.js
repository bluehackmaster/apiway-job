var path = require('path')
var EventEmitter = require('events')
var config = require('../../utils/config')
var spawn = require('child_process').spawn


exports.BuildInfo = function(buildData) {
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

    this.branch = buildData.branch || 'master'
    this.cloneRepo = buildData.cloneRepo || this.repo
    this.checkoutBranch = buildData.checkoutBranch || this.branch
    this.commit = buildData.commit
    this.baseCommit = buildData.baseCommit
    this.comment = buildData.comment
    this.user = buildData.user

    this.isFork = this.cloneRepo != this.repo

    this.committers = buildData.committers

    this.config = null
    this.cloneDir = path.join(config.BASE_BUILD_DIR, this.repo)

    // this.requestId = context.awsRequestId
    // this.logGroupName = context.logGroupName
    // this.logStreamName = context.logStreamName

    this.token = ''
    this.logUrl = ''
    this.lambdaLogUrl = ''
    this.buildDirUrl = ''
    this.error = null
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

    var cloneUrl = `https://github.com/${build.cloneRepo}.git`, maskCmd = cmd => cmd
    if (build.isPrivate && build.token) {
        cloneUrl = `https://${build.token}@github.com/${build.cloneRepo}.git`
        maskCmd = cmd => cmd.replace(new RegExp(build.token, 'g'), 'XXXX')
    }

    var depth = build.isRebuild ? '' : `--depth ${build.config.git.depth}`
    var cloneCmd = `git clone ${depth} ${cloneUrl} -b ${build.checkoutBranch} ${build.cloneDir}`
    // var checkoutCmd = `cd ${build.cloneDir} && git checkout -qf ${build.commit}`

    // Bit awkward, but we don't want the token written to disk anywhere
    if (build.isPrivate && build.token && !build.config.inheritSecrets) {
        cloneCmd = [
            `mkdir -p ${build.cloneDir}`,
            `cd ${build.cloneDir} && git init && git pull ${depth} ${cloneUrl} ${build.checkoutBranch}`,
        ]
    }

    // No caching of clones for now – can revisit this if we want to – but for now, safer to save space
    //var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd, checkoutCmd)
    var cmds = [`rm -rf ${config.BASE_BUILD_DIR}`].concat(cloneCmd)

    var env = prepareLambdaConfig({}).env
    var runCmd = (cmd, cb) => runInBash(cmd, {env: env, logCmd: maskCmd(cmd)}, cb)

    console.log(cmds.length);
    console.log(env);

    async.forEachSeries(cmds, runCmd, cb)
}
