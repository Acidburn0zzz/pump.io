// lib/saveupload.js
//
// The necessary recipe for saving uploaded files
//
// Copyright 2012,2013 E14N https://e14n.com/
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var Step = require("step"),
    path = require("path"),
    fs = require("fs"),
    mkdirp = require("mkdirp"),
    _ = require("underscore"),
    HTTPError = require("../lib/httperror").HTTPError,
    ActivityObject = require("../lib/model/activityobject").ActivityObject,
    URLMaker = require("../lib/urlmaker").URLMaker,
    randomString = require("../lib/randomstring").randomString,
    mm = require("../lib/mimemap"),
    gm = require("gm"),
    typeToClass = mm.typeToClass,
    typeToExt = mm.typeToExt,
    extToType = mm.extToType;

var slowMove = function(oldName, newName, callback) {

    var rs,
        ws,
        onClose = function() {
            clear();
            callback(null);
        },
        onError = function(err) {
            clear();
            callback(err);
        },
        clear = function() {
            rs.removeListener("error", onError);
            ws.removeListener("error", onError);
            ws.removeListener("close", onClose);
        };

    try {
        rs = fs.createReadStream(oldName);
        ws = fs.createWriteStream(newName);
    } catch (err) {
        callback(err);
        return;
    }

    ws.on("close", onClose);
    rs.on("error", onError);
    ws.on("error", onError);

    rs.pipe(ws);
};

var saveUpload = function(user, mimeType, fileName, uploadDir, params, callback) {

    var props,
        now = new Date(),
        ext = typeToExt(mimeType),
        dir = path.join(user.nickname,
                        ""+now.getUTCFullYear(),
                        ""+(now.getUTCMonth() + 1),
                        ""+now.getUTCDate()),
        fulldir = path.join(uploadDir, dir),
        slug,
        obj,
        fname,
        Cls;

    // params are optional

    if (!callback) {
        callback = params;
        params = {};
    }

    Step(
        function() {
            mkdirp(fulldir, this);
        },
        function(err) {
            if (err) throw err;
            randomString(4, this);
        },
        function(err, rnd) {
            if (err) throw err;
            slug = path.join(dir, rnd + "." + ext),
            fname = path.join(uploadDir, slug);
            fs.rename(fileName, fname, this);
        },
        function(err) {
            if (err) {
                if (err.code == "EXDEV") {
                    slowMove(fileName, fname, this);
                } else {
                    throw err;
                }
            } else {
                this(null);
            }
        },
        function(err) {
            var url;
            if (err) throw err;

            url = URLMaker.makeURL("uploads/" + slug);

            Cls = typeToClass(mimeType);

            switch (Cls.type) {
            case ActivityObject.IMAGE:
                props = {
                    _slug: slug,
                    author: user.profile,
                    image: {
                        url: url
                    }
                };
                break;
            case ActivityObject.AUDIO:
            case ActivityObject.VIDEO:
                props = {
                    _slug: slug,
                    author: user.profile,
                    stream: {
                        url: url
                    }
                };
                break;
            case ActivityObject.FILE:
                props = {
                    _slug: slug,
                    author: user.profile,
                    fileUrl: url,
                    mimeType: mimeType
                };
                break;
            default:
                throw new Error("Unknown type.");
            }

            // XXX: summary, or content?

            if (_.has(params, "description")) {
                props.content = params.description;
            }

            if (_.has(params, "title")) {
                props.displayName = params.title;
            }
            
            // Images get some additional metadata

            if (Cls.type == ActivityObject.IMAGE) {
                addImageMetadata(props, uploadDir, this);
            } else {
                this(null, props);
            }
        },
        function(err, props) {
            if (err) throw err;
            Cls.create(props, this);
        },
        function(err, result) {
            if (err) throw err;
            obj = result;
            user.uploadsStream(this);
        },
        function(err, str) {
            if (err) throw err;
            str.deliverObject({id: obj.id, objectType: obj.objectType}, this);
        },
        function(err) {
            if (err) {
                callback(err, null);
            } else {
                callback(null, obj);
            }
        }
    );
};

var MAX_THUMB = 320;

var addImageMetadata = function(props, uploadDir, callback) {

    var fname = path.join(uploadDir, props._slug),
        thumbnail = function(size, callback) {
            var dirname = path.dirname(props._slug),
                extname = path.extname(fname),
                basename = path.basename(fname, extname),
                tslug = path.join(dirname, basename + "_thumb" + extname),
                tname = path.join(uploadDir, tslug),
                width,
                height,
                newWidth,
                newHeight;

            width = size.width;
            height = size.height;

            if (height > MAX_THUMB && height > width) {
                newHeight = MAX_THUMB;
                newWidth = Math.floor(MAX_THUMB * (width * 1.0) / (height * 1.0));
            } else if (width > MAX_THUMB) {
                newWidth = MAX_THUMB;
                newHeight = Math.floor(MAX_THUMB * (height * 1.0) / (width * 1.0));
            }

            Step(
                function() {
                    gm(fname).resize(newWidth, newHeight)
                        .quality(80)
                        .write(tname, this);
                },
                function(err) {
                    if (err) {
                        callback(err, null);
                    } else {
                        props.fullImage = props.image;
                        props.image = {
                            url: URLMaker.makeURL("uploads/" + tslug),
                            width: newWidth,
                            height: newHeight
                        };
                        props._fslug = props._slug;
                        props._slug = tslug;
                        callback(null, props);
                    }
                }
            );
        };

    Step(
        function() {
            gm(fname).size(this);
        },
        function(err, size) {
            if (err) throw err;
            props.image.width  = size.width;
            props.image.height = size.height;
            if (size.width > MAX_THUMB || size.height > MAX_THUMB) {
                thumbnail(size, this);
            } else {
                this(null, props);
            }
        },
        callback
    );
};

exports.saveUpload = saveUpload;
