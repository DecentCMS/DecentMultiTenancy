// Decent Multi-Tenancy (c) 2014-2015 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';

// TODO: Add configurable timeout to request handling.
// TODO: Enable tenants to be restarted.
// TODO: add opt-out for debug mode.
// TODO: emit errors up onto the tenant.

let EventEmitter = require('events').EventEmitter;
let util = require('util');
let path = require('path');
let fs = require('fs');
let http = require('http');
let https = require('https');

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
    options = options || {};
    Object.assign(this, {
      settings: options,
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
   * Creates a tenant from a settings file or object, and adds it to `Tenant.list` and `Tenant.names`.
   * @param {String|Object} settingsh The path of the settings file, or a settings object.
   * @param {Object} [defaults] Default settings.
   * @returns {Tenant} The new tenant.
   */
  static load(settings, defaults) {
    defaults = defaults || {};
    if (typeof settings == 'string') {
      if (path.basename(settings) != 'settings.json') {
        settings = path.join(settings, 'settings.json');
      }
      settings = require(settings);
    }
    for (let settingName of Object.getOwnPropertyNames(defaults)) {
      if (!settings.hasOwnProperty(settingName)) {
        settings[settingName] = defaults[settingName];
      }
    }
    let tenant = new Tenant(settings);
    Tenant.list[tenant.name] = tenant;
    Tenant.names.push(tenant.name);
    return tenant;
  };

  /**
   * Discovers all tenants in the rootPath directory.
   * This method scans the directory for subdirectories with `settings.json` files
   * in them. Those files are then loaded as site settings.
   * @param {Object} defaults The default settings for the tenants.
   * @param {String} rootPath The root path where to look for tenant settings files. Defaults to "./sites".
   */
  static discover(defaults, rootPath) {
    rootPath = rootPath || './sites';
    let siteNames = fs.readdirSync(rootPath);
    for (let siteName of siteNames) {
      if (siteName[0] === '.') continue;
      let resolvedSitePath = path.resolve(rootPath, siteName, 'settings.json');
      let settings;
      try {
        settings = require(resolvedSitePath);
      }
      catch(ex) {
        ex.path = resolvedSitePath;
        ex.message = 'Failed to load site settings for ' + siteName;
        throw ex;
      }
      settings.settingsPath = resolvedSitePath;
      settings.rootPath = resolvedSitePath;
      settings.name = settings.name || siteName;
      Tenant.load(settings, defaults);
    }
  };

  /**
   * Returns the tenant that should handle this request.
   * @param {IncomingMessage} request The request.
   * @returns {Tenant} The tenant that should handle the request, null if no active tenant is fit to do it.
   */
  static resolve(request) {
    let uniqueActiveTenant = null;
    let foundActiveTenant = false;
    // Otherwise let each tenant decide if it can handle the request.
    for (let tenantName of Tenant.names) {
      let tenant = Tenant.list[tenantName];
      if (tenant.active) {
        if (foundActiveTenant) {
          // There's more than one active tenant. One has to answer specifically.
          uniqueActiveTenant = null;
        }
        else {
          foundActiveTenant = true;
          uniqueActiveTenant = tenant;
        }
        if (tenant.canHandle(request)) {
          return tenant;
        }
      }
    }
    // If there's only one tenant, always return that.
    return uniqueActiveTenant
    // Unresolved requests should not go to a default tenant
    // if there's more than one so the above line returning null
    // means no anctive tenant could handle the request.
  };

  /**
   * Starts http listeners covering for all active tenants in `Tenant.list`.
    let httpServer;
   */
  static listen() {
    let httpServer;
    let port = process.env.PORT || 1337;

    let handler = (req, res) => {
      let tenant = Tenant.resolve(req);
      if (!tenant) {
        console.error('Could not resolve tenant.', {url: req.url, host: req.headers.host});
        return;
      }
      tenant.handleRequest(req, res, function(err) {
        if (err) {
          throw err;
        }
        res.end('');
      });
    }
    // If iisnode, only create one server.
    // TODO: properly handle https on IIS.
    if (process.env.IISNODE_VERSION && port.substr(0, 9) === '\\\\.\\pipe\\') {
      httpServer = new http.Server();
      httpServer.on('request', handler);
      httpServer.listen(port);
      return;
    }
    // Listen for each tenant
    for (let tenantName of Tenant.names) {
      let tenant = Tenant.list[tenantName];
      if (!tenant.active) continue;
      let hosts = Array.isArray(tenant.host) ? tenant.host : [tenant.host];
      for (let host of hosts) {
        let currentPort = tenant.port !== '*' ? tenant.port : port;
        // TODO: create debug servers as needed.
        httpServer = tenant.https
            ? https.createServer({
              host: host,
              key: tenant.key,
              cert: tenant.cert,
              pfx: tenant.pfx
            })
            : new http.Server();
        httpServer.on('request', handler);
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
    let host = request.headers.host;
    let hosts = this.host.concat(this.debugHost);
    for (let i = 0; i < hosts.length; i++) {
      let thisHost = hosts[i];
      if ((
        (
        ((this.https && this.port === 443) || this.port === 80 || this.port === '*')
        && thisHost === host
        )
        || (this.port === '*' && host.startsWith(thisHost))
        || (thisHost + ':' + this.port === host)
      ) && (
      !this.path
      || request.url.startsWith(this.path)
      )) {
        if (i >= this.host.length) {
          request.debug = true;
          // We also set the tenant into debug mode, which could cause problems
          // if the same tenant is on a server configured and able to answer on both
          // the host and debug host. That should however never happen.
          this.debug = request.debug;
        }
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
    let self = this;
    let log = this.log;
    // All events use the same context object.
    let context = {
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
 * An empty tenant that you can use to initialize services if you don't need multitenancy.
 */
Tenant.empty = new Tenant({
  name: "Empty tenant"
});

/**
 * The list of tenants.
 */
Tenant.list = {};

/**
 * The names of tenants.
 */
Tenant.names = [];

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
