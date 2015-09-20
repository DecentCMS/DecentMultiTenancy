// Decent Multi-Tenancy (c) 2014-2015 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';

// TODO: Add configurable timeout to request handling.
// TODO: Enable tenants to be restarted.
// TODO: add opt-out for debug mode.
// TODO: log all errors instead of sending them to the console.
// TODO: emit errors up onto the tenant.
// TODO: add logger as an option, fallback to console.

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var path = require('path');
var fs = require('fs');
var http = require('http');
var https = require('https');
var domain = require('domain');

/**
 * A tenant is an independant site in the system.
 */
class Tenant extends EventEmitter {
  /**
  * One should usually refrain from using this constructor directly, and do a `Tenant.load` instead.
  * @param {Object} options
  * @param {String} [options.name] The technical name of the tenant. Default is "default".
  * @param {String} [options.displayName] The display name of the tenant. Default is `name`.
  * @param {String} [options.host] The host name under which the tenant answers. If not specified, this is process.env.IP, or `localhost`.
  * @param {String} [options.debugHost] A host name under which the tenant answers, that causes `request.debug` to be true.
  * @param {Number} [options.port] The port to which the tenant answers. Defaults to `process.env.port`, or 80 if that's not found.
  * @param {Number} [options.debugPort] The port associated with the debug host. Defaults to `process.env.port`, or 1337 if that's not found.
  * @param {Boolean} [options.https] True if the site must use HTTPS. False by default.
  * @param {Boolean} [options.debugHttps] True if the site must use HTTPS in debug mode. False by default.
  * @param {String} [options.cert] The path to the SSL certificate to use with this tenant.
  * @param {String} [options.key] The path to the SSL key to use with this tenant.
  * @param {String} [options.pfx] The path to the pfx SSL certificate to use with this tenant.
  * @param {String} [options.debugCert] The path to the SSL certificate to use with this tenant in debug mode. Defaults to `cert`.
  * @param {String} [options.debugKey] The path to the SSL key to use with this tenant in debug mode. Defaults to `key`.
  * @param {String} [options.debugPfx] The path to the pfx SSL certificate to use with this tenant in debug mode. Defaults to `pfx`.
  * @param {Boolean} [options.active] True if the tenant is active.
  * @param {Object} [options.logger] A logger object with a log(level:string, message:string) method. If not specified, log messages go to the console.
  */
  constructor(options) {
    super();
    Object.assign(this, {
      settings: options || {},
      name: options.name || 'default',
      displayName: options.displayName || options.name,
      host: Array.isArray(options.host)
        ? options.host
        : (options.host
          ? [options.host]
          : (process.env.IP
            ? [process.env.IP]
            : ['localhost'])),
      debugHost: Array.isArray(options.debugHost)
        ? options.debugHost
        : (options.debugHost ? [options.debugHost] : ['localhost']),
      port: options.port || process.env.PORT || 80,
      debugPort: options.debugPort || process.env.PORT || 1337,
      https: !!options.https,
      debugHttps: !!options.debugHttps,
      cert: options.cert,
      key: options.key,
      pfx: options.pfx,
      debugCert: options.debugCert || options.cert,
      debugKey: options.debugKey || options.key,
      debugPfx: options.debugPfx || options.pfx,
      features: options.features || {},
      active: !(options.active === false),
      log: (options.logger ? options.logger.log : null) ||
        function log() {
          console.log.apply(null, arguments);
        }
    });
  }

  /**
   * Creates a tenant from a settings file or object, and adds it to `Tenant.list`.
   * @param {String|Object} settingsh The path of the settings file, or a settings object.
   * @param {Object} [defaults] Default settings.
   * @returns {Tenant} The new tenant.
   */
  static load(settings, defaults) {
    defaults = defaults || {};
    if (typeof settings == 'string') {
      settings.settingsPath = settings;
      settings.rootPath = settings;
      settings = require(settings);
    }
    Object.getOwnPropertyNames(defaults)
      .forEach(function forEachDefaultSetting(settingName) {
        if (!settings.hasOwnProperty(settingName)) {
          settings[settingName] = defaults[settingName];
        }
      });
    var tenant = new Tenant(settings);
    Tenant.list[tenant.name] = tenant;
    return tenant;
  };

  /**
   * Discovers all tenants in the rootPath directory.
   * This method scans the directory for subdirectories with `settings.json` files
   * in them. Those files are then loaded as site settings.
   * @param {Object} defaults The default settings for the shells.
   * @param {String} rootPath The root path where to look for shell settings files. Defaults to "./sites".
   */
  static discover(defaults, rootPath) {
    rootPath = rootPath || './sites';
    var siteNames = fs.readdirSync(rootPath);
    siteNames.forEach(function foreachSiteName(siteName) {
      if (siteName[0] === '.') return;
      var resolvedSitePath = path.resolve(rootPath, siteName, 'settings.json');
      try {
        var settings = require(resolvedSitePath);
      }
      catch(ex) {
        ex.path = resolvedSitePath;
        ex.message = 'Failed to load site settings for ' + siteName;
        throw ex;
      }
      settings.settingsPath = settings;
      settings.rootPath = settings;
      settings.name = settings.name || siteName;
      Tenant.load(settings, defaults);
    });
  };

  /**
   * Returns the tenant that should handle this request.
   * @param {IncomingMessage} request The request.
   * @returns {Tenant} The tenant that should handle the request, null if no active tenant is fit to do it.
   */
  static resolve(request) {
    var shellNames = Object.getOwnPropertyNames(Tenant.list);
    // If there's only one shell, always return that.
    if (shellNames.length === 1) return Tenant.list[shellNames[0]];
    // Otherwise let each shell decide if it can handle the request.
    for (var i = 0; i < shellNames.length; i++) {
      var shell = Tenant.list[shellNames[i]];

      if (shell.active && shell.canHandle(request)) {
        return shell;
      }
    }
    // Unresolved requests should not go to a default shell
    // if there's more than one.
    return null;
  };

  /**
   * Starts http listeners covering for all active tenants in `Tenant.list`.
   */
  static listen() {
    var httpServers = {};
    var port = process.env.PORT || 1337;

    // If iisnode, only create one server.
    // TODO: properly handle https on IIS.
    if (process.env.IISNODE_VERSION && port.substr(0, 9) === '\\\\.\\pipe\\') {
      var httpServer = new http.Server();
      httpServer.on('request', localHandler(httpServer));
      httpServer.listen(port);
      return;
    }
    // Listen for each tenant
    for (var shellName in Tenant.list) {
      var tenant = Tenant.list[shellName];
      if (!tenant.active) continue;
      var hosts = Array.isArray(tenant.host) ? tenant.host : [tenant.host];
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        var currentPort = tenant.port !== '*' ? tenant.port : port;
        // TODO: create debug servers as needed.
        var serverKey = host + currentPort + (tenant.key || "") + (tenant.cert || "") + (tenant.pfx || "");
        httpServer = httpServers.hasOwnProperty(serverKey)
          ? httpServers[serverKey]
          : httpServers[serverKey] = tenant.https
            ? https.createServer({
              host: host,
              key: tenant.key,
              cert: tenant.cert,
              pfx: tenant.pfx
            })
            : new http.Server();
        httpServer.on('request', localHandler(httpServer));
        httpServer.listen(currentPort);
        tenant.log('info', `${tenant.name} started listening on port ${currentPort}.`)
      }
    }
  }

  /**
   * Determines if the tenant can handle that request.
   * @param request The request
   * @returns {Boolean} True if the tenant can handle the request.
   */
  canHandle(request) {
    var host = request.headers.host;
    var hosts = this.host.concat(this.debugHost);
    for (var i = 0; i < hosts.length; i++) {
      var thisHost = hosts[i];
      if ((
        (
        ((this.https && this.port === 443) || this.port === 80 || this.port === '*')
        && thisHost === host
        )
        || (this.port === '*' && host.substr(0, thisHost.length) === thisHost)
        || (thisHost + ':' + this.port === host)
      ) && (
      !this.path
      || request.url.substr(0, this.path.length) === this.path
      )) {
        if (i >= this.host.length) {
          request.debug = true;
        }
        // We also set the tenant into debug mode, which could cause problems
        // if the same tenant is on a server configured and able to answer on both
        // the host and debug host. That should however never happen.
        this.debug = request.debug;
        return true;
      }
    }
    return false;
  };

  /**
   * Enables or disables the tenant.
   * @param {Boolean} state If provided, sets the enabled state of the tenant. Otherwise, enables the tenant.
   */
  enable(state) {
    this.active = typeof state === 'undefined' || !!state;
  };

  /**
   * Disables the tenant.
   */
  disable() {
    this.active = false;
  };

  /**
   * Middleware for use, for example, with Express.
   * @param {http.IncomingMessage} request Request
   * @param {http.ServerResponse} response Response
   * @param {Function} next The callback.
   */
  middleware(request, response, next) {
    if (!this.canHandle(request)) {
      next();
      return;
    }
    this.handleRequest(request, response, next);
  };

  /**
   * Handles the request for the tenant.
   * Emits the following events:
   * * decent.multi-tenancy.start-request {tenant, request, response}
   * * decent.multi-tenancy.handle-request {tenant, request, response}
   * * decent.multi-tenancy.end-request {tenant, request, response}
   * * error
   * @param request Request
   * @param response Response
   * @param {Function} next The callback
   */
  handleRequest(request, response, next) {
    var self = this;
    var log = this.log;
    // All events use the same context object.
    var context = {
      tenant: self,
      request: request,
      response: response
    };
    self.emit(Tenant.startRequestEvent, context);
    self.emit(Tenant.handleRequestEvent, context);
    self.emit(Tenant.endRequestEvent, context);
    if (request.tearDown) request.tearDown();
    this.log('info', 'Handled request', {
      tenant: self.name,
      url: request.url,
      status: response.statusCode
    });
    if (next) next();
  };
}

/**
 * An empty shell that you can use to initialize services if you don't need multitenancy.
 */
Tenant.empty = new Tenant({
  name: "Empty shell"
});

/**
 * @description
 * The list of tenants.
 */
Tenant.list = {};

function localHandler(server) {
  return function defaultHandler(req, res) {
    var d = domain.create();
    d.on('error', function onError(err) {
      console.error('Unrecoverable error', err.stack || err.message || err);
      try {
        // Close down within 30 seconds
        var killTimer = setTimeout(function processKill() {
          process.exit(1);
        }, 30000);
        // But don't keep the process open just for that!
        killTimer.unref();

        // stop taking new requests.
        server.close();

        if (res && !res.finished) {
          // try to send an error to the request that triggered the problem
          res.statusCode = 500;
          // TODO: let route handlers set headers, including powered by.
          res.end('Oops, the server choked on this request!\n');
          // TODO: broadcast the error to give loggers a chance to use it.
        }
      } catch (er2) {
        // oh well, not much we can do at this point.
        console.error('Error sending 500!', er2.stack);
        return;
      }
    });
    d.add(req);
    d.add(res);
    var tenant = Tenant.resolve(req);
    if (!tenant) {
      console.error('Could not resolve shell.', {url: req.url, host: req.headers.host});
      return;
    }
    d.add(tenant);

    // Now run the handler function in the domain.
    d.run(function runHandler() {
      tenant.handleRequest(req, res, function() {
        res.end('');
      });
    });
  }
}

/**
 * @description
 * The event that is broadcast at the beginning of request handling.
 * This is a good time to attach a service to the request object.
 * @type {string}
 */
Tenant.startRequestEvent = 'decent.multi-tenancy.start-request';
Tenant.startRequestEvent_payload = {
  tenant: 'Tenant',
  request: 'IncomingMessage',
  response: 'ServerResponse'
};

/**
 * @description
 * The event that is broadcast when the request is ready to be handled.
 * @type {string}
 */
Tenant.handleRequestEvent = 'decent.multi-tenancy.handle-request';
Tenant.handleRequestEvent_payload = {
  tenant: 'Tenant',
  request: 'IncomingMessage',
  response: 'ServerResponse'
};

/**
 * @description
 * The event that is broadcast at the end of request handling.
 * This is a good time to clean-up, detach services and events.
 * @type {string}
 */
Tenant.endRequestEvent = 'decent.multi-tenancy.end-request';
Tenant.endRequestEvent_payload = {
  tenant: 'Tenant',
  request: 'IncomingMessage',
  response: 'ServerResponse'
};

module.exports = Tenant;
