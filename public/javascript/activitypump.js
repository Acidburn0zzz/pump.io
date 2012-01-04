(function($, Backbone) {

    $(document).ready(function() {

        var User = Backbone.Model.extend({
        });

        var currentUser = null; // XXX: load from server...?

        var TemplateView = Backbone.View.extend({
            template: null,
            templateName: null,
            render: function() {
                var tmpl = '/template/'+this.templateName+'.template',
                    view = this;
                if (!view.template) {
                    $.get(tmpl, function(data) {
                        view.template = _.template(data);
                        $(view.el).html(view.template(view.model.toJSON()));
                    });
                } else {
                    $(view.el).html(view.template(view.model.toJSON()));
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
                    params = {username: this.$("#username").val(),
                              password: this.$("#password").val()};

                $.post("/login", params, function(user) {
                    currentUser = user;
                    var un = new UserNav({model: currentUser});
                    un.render();
                    view.el.replaceWith(un.el);
                });
                return false;
            }
        });

        var UserNav = TemplateView.extend({
            tagname: "div",
            classname: "nav",
            templateName: 'nav-loggedin',
            events: {
                "click #logout": "logout"
            },
            logout: function() {
                var view = this;
                $.post("/logout", function(data) {
                    currentUser = null;
                    var an = new AnonymousNav();
                    an.render();
                    view.el.replaceWith(an.el);
                });
            }
        });

        var ActivityPump = Backbone.Router.extend({

            routes: {
                "":                 "public",    
                ":nickname":        "profile",   
                ":nickname/inbox":  "inbox",  
                "activity/:id":     "activity",
                "settings":         "settings"
            },

            currentContent: null,
            currentSidebar: null,
            currentTitle: null,

            public: function() {
            },

            profile: function(nickname) {
            },

            inbox: function(nickname) {
            },

            activity: function(id) {
            },
        });

        var ap = new ActivityPump();

        var nav;

        if ($("#topnav #login").length > 0) {
            nav = new AnonymousNav({el: "#topnav"});
        } else {
            nav = new UserNav({el: "#topnav"});
        }

        Backbone.history.start({pushState: true, silent: true});
    });

})(window.jQuery, window.Backbone);
