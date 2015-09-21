Decent Multi-tenancy
====================

The Decent Multi-tenancy module enables the hosting of multiple web sites on
a single Node server and process.

Any number of sites can be configured so they can each handle incoming requests
independently, and according to their settings.
Which site will handle the request is based on matching the request with the
settings of the site.

It's important to understand that the library is not a mechanism for isolation.
The sites run in the same process, and if one site accessing the data from
another is a concern, they should run in separate processes.

The separation of data between sites is the responsibility of the client code,
which can choose to expose common data between the sites, or to use separate
data for each, or any combination it wishes.

One should keep in mind that multi-tenancy, although extremely useful for
improving site density, or for building federations of sites, also presents a
number of disadvantages. For example, a high load on one of the sites can
affect the others.

Spinning multiple sites
-----------------------

The following code creates two tenants, that will respond respectively to
requests on ports 1337 and 1338.
The handle request event on each tenant is wired to the same handler, that
displays a welcome message that is differentiated by tenant.

```js
console.log("Node.js with multi-tenancy");
var Tenant = require('decent-multi-tenancy');

var handler = function (payload) {
    var res = payload.response;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello World from ' + payload.tenant.displayName);
};

var tenant1 = Tenant.load({
    name: "Tenant 1",
    port: 1337
});
tenant1.on(Tenant.handleRequestEvent, handler);

var tenant2 = Tenant.load({
    name: "Tenant 2",
    port: 1338
});
tenant2.on(Tenant.handleRequestEvent, handler);

Tenant.listen();
```

The settings file
-----------------

Tenants don't have to be set-up from code. They can also be discovered from
settings files by calling `Tenant.discover`.
By default, `discover` looks for `settings.json` files under subfolders of the
`./sites` directory.

The `settings.json` file at the root of each site's folder defines
the site's settings, such as its name, and any custom settings that your
application may need.

Top-level properties of the settings object described by the file
can include:

* **name**: the technical name of the site.
* **displayName**: the friendly name of the site.
  This is often used by the theme to be included in the site's header
  or to build the title of the site's pages.
* **host**: a string or an array of strings describing all the host
  names that the site must respond to.
* **debugHost** a string or an array of strings describing the host
  names that the site must respond to, but do so in debug mode.
  In debug mode, `shell.debug` and `request.debug` are true.
* **port**: the port number for the site, or `"*"` if it must respond
  on any port.
* **debugPort**: the port number that the site must respond to in
  debug mode.
* **https**: true if the site must use HTTPS.
* **debugHttps**: true if the site must use HTTPS in debug mode.
* **cert**: the path to the SSL certificate file.
* **key**: the path to the SSL key file.
* **pfx**: the path to the pfx SSL certificate file.
* **debugCert**, **debugKey**, and **debugPfx**: the SSL data to use
in debug mode.
* **active**: set to false to disable the tenant when loading it.
