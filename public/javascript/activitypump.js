(function($, Backbone) {

    var Activity = Backbone.Model.extend({
        url: function() {
            var links = this.get("links"),
                uuid = this.get("uuid");
            if (links && _.isObject(links) && links.self) {
                return links.self;
            } else if (uuid) {
                return "/api/activity/" + uuid;
            } else {
                return null;
            }
        }
    });

    var oauthify = function(options) {

        if (options.url.indexOf(':') == -1) {
            if (options.url.substr(0, 1) == '/') {
                options.url = window.location.protocol + '//' + window.location.host + options.url;
            } else {
                options.url = window.location.href.substr(0, window.location.href.lastIndexOf('/') + 1) + options.url;
            }
        }

        var message = { action: options.url,
                        method: options.type,
                        parameters: [["oauth_version", "1.0"], ["oauth_consumer_key", options.consumerKey]]
                      };

        OAuth.setTimestampAndNonce(message);
        OAuth.SignatureMethod.sign(message,
                                   {consumerSecret: options.consumerSecret,
                                    tokenSecret: options.tokenSecret});

        var header =  OAuth.getAuthorizationHeader("OAuth", message.parameters);

        options.headers = {Authorization: header};

        return options;
    };

    var ActivityStream = Backbone.Collection.extend({
	model: Activity,
        parse: function(response) {
            return response.items;
        }
    });

    var UserStream = ActivityStream.extend({
        user: null,
        initialize: function(models, options) {
            this.user = options.user;
        },
        url: function() {
            return "/api/user/" + this.user.get("nickname") + "/feed";
        }
    });

    var UserInbox = ActivityStream.extend({
        user: null,
        initialize: function(models, options) {
            this.user = options.user;
        },
        url: function() {
            return "/api/user/" + this.user.get("nickname") + "/inbox";
        }
    });

    var Person = Backbone.Model.extend({
	url: function() {
            var links = this.get("links"),
                uuid = this.get("uuid");
            if (links && _.isObject(links) && links.self) {
                return links.self;
            } else if (uuid) {
                return "/api/person/" + uuid;
            } else {
                return null;
            }
	}
    });

    var User = Backbone.Model.extend({
	initialize: function() {
	    this.profile = new Person(this.get("profile"));
	},
        url: function() {
            return "/api/user/" + this.get("nickname");
        },
        getStream: function() {
            return new UserStream([], {user: this});
        },
        getInbox: function() {
            return new UserInbox([], {user: this});
        }
    });

    var currentUser = null; // XXX: load from server...?

    var templates = {};

    var TemplateView = Backbone.View.extend({
        templateName: null,
        render: function() {
            var name = this.templateName,
                url = '/template/'+name+'.utml',
                view = this,
                json = (!view.model) ? {} : ((view.model.toJSON) ? view.model.toJSON() : view.model);

            if (!templates[name]) {
                $.get(url, function(data) {
                    templates[name] = _.template(data);
                    $(view.el).html(templates[name](json));
                });
            } else {
                $(view.el).html(templates[name](json));
            }
            return this;
        }
    });

    var AnonymousNav = TemplateView.extend({
        tagname: "div",
        classname: "nav",
        templateName: 'nav-anonymous',
        events: {
            "submit #login": "login"
        },
        login: function() {
            var view = this,
                params = {nickname: this.$('#login input[name="nickname"]').val(),
                          password: this.$('#login input[name="password"]').val()};

            $.post("/main/login", params, function(user) {
                currentUser = new User(user);
                var un = new UserNav({model: currentUser, el: view.el});
                un.render();
            });
            return false;
        }
    });

    var UserNav = TemplateView.extend({
        tagname: "div",
        classname: "nav",
        templateName: 'nav-loggedin',
        events: {
            "click #logout": "logout",
            "submit #post-note": "postNote"
        },
        initialize: function() {
            _.bindAll(this, "postNote");
            _.bindAll(this, "logout");
        },
        postNote: function() {

            var view = this,
		user = currentUser,
		profile = user.profile,
		act = new Activity(),
		stream = new UserStream({user: user});

	    stream.create({object: {objectType: "note",
				    content: this.$("#note-content").val()}});

            return false;
        },
        logout: function() {
            var view = this;
            $.post("/main/logout", {nickname: currentUser.nickname}, function(data) {
                currentUser = null;
                var an = new AnonymousNav({el: view.el});
                an.render();
            });
            return false;
        }
    });

    var MainContent = TemplateView.extend({
        templateName: 'main',
        el: '#content'
    });

    var RegisterContent = TemplateView.extend({
        templateName: 'register',
        el: '#content',
        events: {
            "submit #registration": "register"
        },
        register: function() {
            var view = this,
                params = {nickname: view.$('#registration input[name="nickname"]').val(),
                          password: view.$('#registration input[name="password"]').val()},
                options,
                onSuccess = function(data, textStatus, jqXHR) {
                    ap.navigate('/inbox/' + params.nickname);
                };

            // XXX: validate nickname
            // XXX: validate password
            // XXX: make sure repeat = password
            // 
            // XXX: compare password to repeat

            options = {
                contentType: "application/json",
                data: JSON.stringify(params),
                dataType: "json",
                type: "POST",
                url: "/api/users",
                success: onSuccess
            };

            ensureCred(function(err, cred) {
                if (err) {
                    console.log("Couldn't get OAuth credentials. :(");
                } else {
                    options.consumerKey = cred.clientID;
                    options.consumerSecret = cred.clientSecret;
                    options = oauthify(options);
                    $.ajax(options);
                }
            });

            return false;
        }
    });

    var UserPageContent = TemplateView.extend({
        templateName: 'user-page-content',
        el: '#content'
    });

    var InboxContent = TemplateView.extend({
        templateName: 'inbox-content',
        el: '#content'
    });

    var ActivityContent = TemplateView.extend({
        templateName: 'activity-content',
        el: '#content'
    });

    var SettingsContent = TemplateView.extend({
        initialize: function() {
            _.bindAll(this, "saveSettings");
        },
        templateName: 'settings-content',
        el: '#content',
        events: {
            "submit #settings": "saveSettings"
        },
        saveSettings: function() {

            var view = this,
		user = currentUser,
		profile = user.profile;

	    user.set({"password": this.$("#password").val()});

	    user.save();

	    profile.set({"displayName": this.$('#realname').val(),
	                 "window.location": { displayName: this.$('#window.location').val() },
	                 "summary": this.$('#bio').val()});

	    profile.save();

            return false;
        }
    });

    var ActivityPump = Backbone.Router.extend({

        routes: {
            "":                       "public",    
            ":nickname":              "profile",   
            ":nickname/inbox":        "inbox",  
            ":nickname/activity/:id": "activity",
            "main/settings":          "settings",
            "main/register":          "register"
        },

	register: function() {
            var content = new RegisterContent();

            content.render();
        },

	settings: function() {
            var content = new SettingsContent({model: currentUser});

            content.render();
	},

        "public": function() {
            var content = new MainContent({model: {site: config.site}});

            content.render();
        },

        profile: function(nickname) {
            var user = new User({nickname: nickname}),
                stream = user.getStream();

            user.fetch({success: function(user, response) {
                stream.fetch({success: function(stream, response) {
                    var content = new UserPageContent({model: {actor: user.toJSON(), stream: stream.toJSON()}});

                    content.render();
                }});
            }});
        },

        inbox: function(nickname) {
            var user = new User({nickname: nickname}),
                inbox = user.getInbox();

            user.fetch({success: function(user, response) {
                inbox.fetch({success: function(inbox, response) {
                    var content = new InboxContent({model: {user: user.toJSON(), stream: inbox.toJSON()}});

                    content.render();
                }});
            }});
        },

        activity: function(nickname, id) {
            var act = new Activity({uuid: id, userNickname: nickname});

            act.fetch({success: function(act, response) {
                var content = new ActivityContent({model: act});

                content.render();
            }});
        }
    });

    var BodyView = Backbone.View.extend({
        initialize: function(options) {
            this.router = options.router;
            _.bindAll(this, "navigateToHref");
        },
        el: "body",
        events: {
            "click a": "navigateToHref"
        },
        navigateToHref: function(ev) {
            var el = (ev.srcElement || ev.currentTarget),
                pathname = el.pathname, // XXX: HTML5
                here = window.location;

            if (!el.host || el.host === here.host) {
                this.router.navigate(pathname, true);
            }

            return false;
        }
    });

    var clientID, clientSecret, credReq;

    var getCred = function() {
        if (clientID) {
            return {clientID: clientID, clientSecret: clientSecret};
        } else if (localStorage) {
            clientID = localStorage['cred:clientID'];
            clientSecret = localStorage['cred:clientSecret'];
            if (clientID) {
                return {clientID: clientID, clientSecret: clientSecret};
            } else {
                return null;
            }
        } else {
            return null;
        }
    };

    var ensureCred = function(callback) {
        var cred = getCred();
        if (cred) {
            callback(null, cred);
        } else if (credReq) {
            credReq.success(function(data) {
                callback(null, {clientID: data.client_id,
                                clientSecret: data.client_secret});
            });
            credReq.error(function() {
                callback(new Error("error getting credentials"), null);
            });
        } else {
            credReq = $.post("/api/client/register",
                               {type: "client_associate",
                                application_name: config.site + " Web",
                                application_type: "web"},
                               function(data) {
                                   credReq = null;
                                   clientID = data.client_id;
                                   clientSecret = data.client_secret;
                                   if (localStorage) {
                                       localStorage['cred:clientID'] = clientID;
                                       localStorage['cred:clientSecret'] = clientSecret;
                                   }
                                   callback(null, {clientID: clientID,
                                                   clientSecret: clientSecret});
                               },
                               "json");
            credReq.error(function() {
                callback(new Error("error getting credentials"), null);
            });
        }
    };

    var ap;

    $(document).ready(function() {

        ap = new ActivityPump();

        var bv = new BodyView({router: ap});

        var nav;

        if ($("div.navbar #login").length > 0) {
            nav = new AnonymousNav({el: "#topnav"});
        } else {
            nav = new UserNav({el: "#topnav"});
        }

        ensureCred(function(err) {});

        Backbone.history.start({pushState: true, silent: true});
    });

})(window.jQuery, window.Backbone);
