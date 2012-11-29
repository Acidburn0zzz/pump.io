// app.js
//
// main function for activity pump application
//
// Copyright 2011-2012, StatusNet Inc.
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

var auth = require("connect-auth"),
    Step = require("step"),
    databank = require("databank"),
    express = require("express"),
    _ = require("underscore"),
    fs = require("fs"),
    path = require("path"),
    Logger = require("bunyan"),
    uuid = require("node-uuid"),
    email = require("emailjs"),
    api = require("../routes/api"),
    web = require("../routes/web"),
    webfinger = require("../routes/webfinger"),
    clientreg = require("../routes/clientreg"),
    dialback = require("../routes/dialback"),
    oauth = require("../routes/oauth"),
    schema = require("./schema").schema,
    HTTPError = require("./httperror").HTTPError,
    Provider = require("./provider").Provider,
    URLMaker = require("./urlmaker").URLMaker,
    Databank = databank.Databank,
    DatabankObject = databank.DatabankObject,
    DatabankStore = require('connect-databank')(express);

var makeApp = function(config, callback) {

    var params,
        defaults = {port: 31337,
                    hostname: "127.0.0.1",
                    site: "pump.io"},
        port,
        hostname,
        address,
        log,
        db,
        logParams = {
            name: "pump.io",
            serializers: {
                req: Logger.stdSerializers.req,
                res: Logger.stdSerializers.res,
                user: function(user) {
                    if (user) {
                        return {nickname: user.nickname};
                    } else {
                        return {nickname: "<none>"};
                    }
                },
                client: function(client) {
                    if (client) {
                        return {key: client.consumer_key, title: client.title || "<none>"};
                    } else {
                        return {key: "<none>", title: "<none>"};
                    }
                }
            }
        };

    config = _.extend(defaults, config);

    port     = config.port;
    hostname = config.hostname;
    address  = config.address || config.hostname;

    if (config.logfile) {
        logParams.streams = [{path: config.logfile}];
    } else if (config.nologger) {
        logParams.streams = [{path: "/dev/null"}];
    } else {
        logParams.streams = [{stream: process.stderr}];
    }

    log = new Logger(logParams);

    log.info("Initializing pump.io");

    // Initiate the DB

    if (_(config).has("params")) {
        params = config.params;
    } else {
        params = {};
    }

    if (_(params).has("schema")) {
        _.extend(params.schema, schema);
    } else {
        params.schema = schema;
    }

    _.extend(params.schema, DatabankStore.schema);

    db = Databank.get(config.driver, params);

    // Connect...

    log.info("Connecting to databank with driver '"+config.driver+"'");

    db.connect({}, function(err) {

        var useHTTPS = _(config).has('key'),
            useBounce = _(config).has('bounce') && config.bounce,
            app,
            bounce,
            maillog,
            smtp,
            from,
            requestLogger = function(log) {
                return function(req, res, next) {
                    var weblog = log.child({"req_id": uuid.v4(), component: "web"});
                    var end = res.end;
                    req.log = weblog;
                    res.end = function(chunk, encoding) {
                        var rec;
                        res.end = end;
                        res.end(chunk, encoding);
                        rec = {req: req, res: res};
                        if (_(req).has("remoteUser")) {
                            rec.user = req.remoteUser;
                        }
                        if (_(req).has("client")) {
                            rec.client = req.client;
                        }
                        weblog.info(rec);
                    };
                    next();
                };
            };

        if (err) {
            log.error(err);
            callback(err, null);
            return;
        }

        if (useHTTPS) {
            log.info("Setting up HTTPS server.");
            app = express.createServer({key: fs.readFileSync(config.key),
                                        cert: fs.readFileSync(config.cert)});

            if (useBounce) {
                log.info("Setting up micro-HTTP server to bounce to HTTPS.");
                bounce = express.createServer(function(req, res, next) {
                    var host = req.header('Host');
                    res.redirect('https://'+host+req.url, 301);
                });
            }

        } else {
            log.info("Setting up HTTP server.");
            app = express.createServer();
        }

        app.config = config;

        if (config.smtpserver) {

            maillog = log.child({component: "mail"});

            maillog.info("Connecting to SMTP server " + config.smtpserver);

            smtp = email.server.connect({
                user: config.smtpuser || null,
                password: config.smtppass || null,
                host: config.smtpserver,
                port: config.smtpport || null,
                ssl: config.smtpusessl || false
            });

            from = config.smtpfrom || "no-reply@"+hostname;

            app.sendEmail = function(props, callback) {

                var message = _.extend({"from": from}, props);

                smtp.send(message, function(err, message) {
                    if (err) {
                        maillog.error({msg: "Sending email",
                                       to: message.to || null,
                                       subject: message.subject || null});
                        callback(err, null);
                    } else {
                        maillog.info({msg: "Message sent",
                                      to: message.to || null,
                                      subject: message.subject || null});
                        callback(null, message);
                    }
                });
            };
        }

        var rawFileBody = function(req, res, next) {

            var buf,
                len,
                offset = 0,
                mimeType;

            if (req.method != "PUT" && req.method != "POST") {
                next();
                return;
            }

            mimeType = req.headers["content-type"];

            if (_.has(express.bodyParser.parse, mimeType)) {
                next();
                return;
            }

            if (_.has(req.headers, "content-length")) {
                try {
                    len = parseInt(req.headers["content-length"], 10);
                } catch (e) {
                    next(e);
                    return;
                }
            }

            if (len) {
                buf = new Buffer(len);
            } else {
                buf = new Buffer(0);
            }

            req.on("data", function(chunk) {
                if (len) {
                    chunk.copy(buf, offset);
                    offset += chunk.length;
                } else {
                    buf = Buffer.concat([buf, chunk]);
                }
            });

            req.on("err", function(err) {
                buf = null;
                next(err);
            });

            req.on("end", function() {
                req.body = buf;
                next();
            });
        };

        var cleanup = config.cleanup || 600000;
        var dbstore = new DatabankStore(db, log, cleanup);

        if (!_(config).has("noweb") || !config.noweb) {
            app.session = express.session({secret: (_(config).has('sessionSecret')) ? config.sessionSecret : "insecure",
                                           store: dbstore});
        }

        // Configuration

        app.configure(function() {

            // Templates are in public
            app.set("views", __dirname + "/../public/template");
            app.set("view engine", "utml");
            app.use(requestLogger(log));
            app.use(rawFileBody);
            app.use(express.bodyParser());
            app.use(express.cookieParser());
            app.use(express.query());
            app.use(express.methodOverride());
            app.use(express.favicon());

            app.provider = new Provider(log);

            app.use(function(req, res, next) { 
                res.local("config", config);
                res.local("data", {});
                res.local("page", {});
                res.local("template", {});
                // Initialize null
                res.local("remoteUser", null);
                res.local("user", null);
                res.local("client", null);
                res.local("nologin", false);
                next();
            });

            app.use(auth([auth.Oauth({name: "client",
                                      realm: "OAuth",
                                      oauth_provider: app.provider,
                                      oauth_protocol: (useHTTPS) ? 'https' : 'http',
                                      authenticate_provider: null,
                                      authorize_provider: null,
                                      authorization_finished_provider: null
                                     }),
                          auth.Oauth({name: "user",
                                      realm: "OAuth",
                                      oauth_provider: app.provider,
                                      oauth_protocol: (useHTTPS) ? 'https' : 'http',
                                      authenticate_provider: oauth.authenticate,
                                      authorize_provider: oauth.authorize,
                                      authorization_finished_provider: oauth.authorizationFinished
                                     })
                         ]));

            app.use(app.router);

            app.use(express["static"](__dirname + "/../public"));

        });

        app.error(function(err, req, res, next) {
            log.error(err);
            if (err instanceof HTTPError) {
                if (req.xhr || req.originalUrl.substr(0, 5) === '/api/') {
                    res.json({error: err.message}, err.code);
                } else if (req.accepts("html")) {
                    res.render("error", {status: err.code, error: err, title: "Error"});
                } else {
                    res.writeHead(err.code, {"Content-Type": "text/plain"});
                    res.end(err.message);
                }
            } else {
                next(err);
            }
        });

        // Routes

        api.addRoutes(app);
        webfinger.addRoutes(app);
        dialback.addRoutes(app);
        clientreg.addRoutes(app);

        // Use "noweb" to disable Web site (API engine only)

        if (!_(config).has("noweb") || !config.noweb) {
            web.addRoutes(app);
        } else {
            // A route to show the API doc at root
            app.get("/", function(req, res, next) {

                var Showdown = require("showdown"),
                    converter = new Showdown.converter();

                Step(
                    function() {
                        fs.readFile(path.join(__dirname, "..", "API.md"), this);
                    },
                    function (err, data) {
                        var html, markdown;
                        if (err) {
                            next(err);
                        } else {
                            markdown = data.toString();
                            html = converter.makeHtml(markdown);
                            res.render("doc", {page: {title: "API"},
                                               data: {html: html}});
                        }
                    }
                );
            });
        }

        DatabankObject.bank = db;

        URLMaker.hostname = hostname;
        URLMaker.port = port;

        if (_(config).has('serverUser')) {
            app.on('listening', function() {
                process.setuid(config.serverUser);
            });
        }

        app.run = function(callback) {
            var self = this,
                removeListeners = function() {
                    self.removeListener("listening", listenSuccessHandler);
                    self.removeListener("err", listenErrorHandler);
                },
                listenErrorHandler = function(err) {
                    removeListeners();
                    log.error(err);
                    callback(err);
                },
                listenSuccessHandler = function() {
                    var removeBounceListeners = function() {
                        bounce.removeListener("listening", bounceSuccess);
                        bounce.removeListener("err", bounceError);
                    },
                        bounceError = function(err) {
                            removeBounceListeners();
                            log.error(err);
                            callback(err);
                        },
                        bounceSuccess = function() {
                            log.info("Finished setting up bounce server.");
                            removeBounceListeners();
                            callback(null);
                        };
                    
                    log.info("Finished setting up main server.");

                    removeListeners();
                    if (useBounce) {
                        bounce.on("error", bounceError);
                        bounce.on("listening", bounceSuccess);
                        bounce.listen(80, hostname);
                    } else {
                        callback(null);
                    }
                };
            this.on("error", listenErrorHandler);
            this.on("listening", listenSuccessHandler);
            log.info("Listening on "+port+" for host " + address);
            this.listen(port, address);
        };

        callback(null, app);
    });
};

exports.makeApp = makeApp;
