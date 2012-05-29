// oauth.js
//
// Utilities for generating clients, request tokens, and access tokens
//
// Copyright 2012, StatusNet Inc.
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

var Step = require('step'),
    _ = require('underscore'),
    http = require('http'),
    OAuth = require('oauth').OAuth,
    Browser = require('zombie'),
    httputil = require('./http');

var requestToken = function(cl, cb) {
    var oa;
    oa = new OAuth('http://localhost:4815/oauth/request_token',
                   'http://localhost:4815/oauth/access_token',
                   cl.client_id,
                   cl.client_secret,
                   "1.0",
                   "oob",
                   "HMAC-SHA1",
                   null, // nonce size; use default
                   {"User-Agent": "activitypump-test/0.1.0"});
    
    oa.getOAuthRequestToken(function(err, token, secret) {
        if (err) {
            cb(new Error(err.data), null);
        } else {
            cb(null, {token: token, token_secret: secret});
        }
    });
};

var newClient = function(cb) {
    httputil.post('localhost', 4815, '/api/client/register', {type: 'client_associate'}, function(err, res, body) {
        var cl;
        if (err) {
            cb(err, null);
        } else {
            try {
                cl = JSON.parse(body);
                cb(null, cl);
            } catch (err) {
                cb(err, null);
            }
        }
    });
};

var accessToken = function(cl, user, cb) {
    var rt, browser;

    Step(
        function() {
            requestToken(cl, this);
        },
        function(err, res) {
            if (err) throw err;
            rt = res;
            browser = new Browser();
            browser.runScripts = false;
            browser.visit("http://localhost:4815/oauth/authorize?oauth_token=" + rt.token, this);
        },
        function(err, br) {
            if (err) throw err;
            if (!browser.success) throw new Error("Bad auth result");
            browser.fill("username", user.nickname)
                .fill("password", user.password)
                .pressButton("#authenticate", this);
        },
        function(err, br) {
            if (err) throw err;
            if (!browser.success) throw new Error("Bad auth result");
            browser.pressButton("Authorize", this);
        },
        function(err, br) {
            var oa, verifier;
            if (err) throw err;
            if (!browser.success) throw new Error("Bad auth result");
            verifier = browser.text("#verifier");
            oa = new OAuth('http://localhost:4815/oauth/request_token',
                           'http://localhost:4815/oauth/access_token',
                           cl.client_id,
                           cl.client_secret,
                           "1.0",
                           "oob",
                           "HMAC-SHA1",
                           null, // nonce size; use default
                           {"User-Agent": "activitypump-test/0.1.0"});
                                        
            oa.getOAuthAccessToken(rt.token, rt.token_secret, verifier, this);
        },
        function(err, token, secret) {
            if (err) {
                if (err instanceof Error) {
                    cb(err, null);
                } else {
                    cb(new Error(err.data), null);
                }
            } else {
                cb(null, {token: token, token_secret: secret});
            }
        }
    );
};

var register = function(cl, nickname, password, callback) {
    var cb = this.callback;

    httputil.postJSON('http://localhost:4815/api/users', 
                      {consumer_key: cl.client_id, consumer_secret: cl.client_secret}, 
                      {nickname: nickname, password: password},
                      function(err, res, body) {
                          var user;
                          if (err) {
                              cb(new Error(err.data), null);
                          } else {
                              try {
                                  user = JSON.parse(body);
                                  cb(null, user);
                              } catch (err) {
                                  cb(err, null);
                              }
                          }
                      });
};

var newCredentials = function(nickname, password, cb) {
    var cl, user;

    Step(
        function() {
            newClient(this);
        },
        function(err, res) {
            if (err) throw err;
            cl = res;
            register(nickname, password, this);
        },
        function(err, res) {
            if (err) throw err;
            user = {nickname: nickname, password: password};
            accessToken(cl, user, this);
        },
        function(err, res) {
            if (err) {
                cb(err);
            } else {
                _.extend(cl, res);
                cb(err, cl);
            }
        }
    );
};

var setupApp = function(callback) {

    var cb = callback,
        config = {port: 4815,
                  hostname: 'localhost',
                  driver: 'memory',
                  params: {},
                  nologger: true
                 },
        app = null,
        makeApp = require('../../lib/app').makeApp;

    process.env.NODE_ENV = 'test';

    Step(
        function() {
            makeApp(config, this);
        },
        function(err, res) {
            if (err) throw err;
            app = res;
            app.run(this);
        },
        function(err) {
            if (err) {
                cb(err, null);
            } else {
                cb(null, app);
            }
        }
    );
};

exports.requestToken = requestToken;
exports.newClient = newClient;
exports.register = register;
exports.newCredentials = newCredentials;
exports.accessToken = accessToken;
exports.setupApp = setupApp;
