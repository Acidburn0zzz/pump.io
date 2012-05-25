// http.js
//
// HTTP utilities for testing
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

var http = require('http'),
    assert = require('assert'),
    querystring = require('querystring'),
    _ = require('underscore'),
    OAuth = require('oauth').OAuth;

var endpoint = function(url, methods) {
    var context = {
        topic: function() {
            options('localhost', 4815, url, this.callback);
        },
        'it exists': function(err, allow, res, body) {
            assert.ifError(err);
            assert.equal(res.statusCode, 200);
        }
    };
    var i;

    for (i = 0; i < methods.length; i++) {
        context['it supports '+methods[i]] = function(err, allow, res, body) {
            assert.include(allow, methods[i]);
        };
    }
    return context;
};

var options = function(host, port, path, callback) {

    var reqOpts = {
        host: host,
        port: port,
        path: path,
        method: 'OPTIONS',
        headers: {
            'User-Agent': 'activitypump-test/0.1.0dev'
        }
    };

    var req = http.request(reqOpts, function(res) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            body = body + chunk;
        });
        res.on('error', function(err) {
            callback(err, null, null, null);
        });
        res.on('end', function() {
            var allow = [];
            if (_(res.headers).has('allow')) {
                allow = res.headers.allow.split(',').map(function(s) { return s.trim(); });
            }
            callback(null, allow, res, body);
        });
    });

    req.on('error', function(err) {
        callback(err, null, null, null);
    });

    req.end();
};

var post = function(host, port, path, params, callback) {

    var requestBody = querystring.stringify(params);

    var reqOpts = {
        host: host,
        port: port,
        path: path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': requestBody.length,
            'User-Agent': 'activitypump-test/0.1.0dev'
        }
    };

    var req = http.request(reqOpts, function(res) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            body = body + chunk;
        });
        res.on('error', function(err) {
            callback(err, null, null);
        });
        res.on('end', function() {
            callback(null, res, body);
        });
    });

    req.on('error', function(err) {
        callback(err, null, null);
    });

    req.write(requestBody);

    req.end();
};

var postJSON = function(serverUrl, cred, payload, callback) {

    var oa, toSend;

    oa = new OAuth(null, // request endpoint N/A for 2-legged OAuth
                   null, // access endpoint N/A for 2-legged OAuth
                   cred.consumer_key,
                   cred.consumer_secret,
                   "1.0",
                   null,
                   "HMAC-SHA1",
                   null, // nonce size; use default
                   {"User-Agent": "activitypump-test/0.1.0"});
    
    toSend = JSON.stringify(payload);

    oa.post(serverUrl, cred.token, cred.token_secret, toSend, 'application/json', function(err, data, response) {
        // Our callback has swapped args to OAuth module's
        callback(err, response, data);
    });
};

var getJSON = function(serverUrl, cred, callback) {

    var oa, toSend;

    oa = new OAuth(null, // request endpoint N/A for 2-legged OAuth
                   null, // access endpoint N/A for 2-legged OAuth
                   cred.consumer_key,
                   cred.consumer_secret,
                   "1.0",
                   null,
                   "HMAC-SHA1",
                   null, // nonce size; use default
                   {"User-Agent": "activitypump-test/0.1.0"});
    
    oa.get(serverUrl, cred.token, cred.token_secret, function(err, data, response) {
        var results;
        if (err) {
            callback(new Error(err.data), null);
        } else {
            try {
                results = JSON.parse(data);
                callback(null, results);
            } catch (err) {
                callback(err, null);
            }
        }
    });
};

exports.options = options;
exports.post = post;
exports.postJSON = postJSON;
exports.getJSON = getJSON;
exports.endpoint = endpoint;
