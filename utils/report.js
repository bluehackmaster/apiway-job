var util = require('util')
var fs = require('fs')
var AWS = require('aws-sdk');

var s3 = require('s3');
var awsS3Client = new AWS.S3({signatureVersion: 'v4'})
var options = {
  s3Client: awsS3Client,
  // more options available. See API docs below.
};
var client = s3.createClient(options);



exports.uploadS3 = function (bucket, key, file) {
  var params = {
    localFile: file,

    s3Params: {
      Bucket: bucket,
      Key: key,
      // other options supported by putObject, except Body and ContentLength.
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
    },
  };
  var uploader = client.uploadFile(params);
  uploader.on('error', function(err) {
    console.error("unable to upload:", err.stack);
  });
  uploader.on('progress', function() {
    // console.log("progress", uploader.progressMd5Amount,
    //   uploader.progressAmount, uploader.progressTotal);
  });
  uploader.on('end', function() {
    console.log("done uploading");
  });
}

exports.syncDirS3 = function (bucket, remoteDir, dir) {
  var params = {
    localDir: dir,
    deleteRemoved: true, // default false, whether to remove s3 objects
                         // that have no corresponding local file.
    s3Params: {
      Bucket: bucket,
      Prefix: remoteDir
      // other options supported by putObject, except Body and ContentLength.
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
    },
  };
  var uploader = client.uploadDir(params);
  uploader.on('error', function(err) {
    console.error("unable to sync:", err.stack);
  });
  uploader.on('progress', function() {
    // console.log("progress", uploader.progressAmount, uploader.progressTotal);
  });
  uploader.on('end', function() {
    // console.log("done uploading");
  });
}
