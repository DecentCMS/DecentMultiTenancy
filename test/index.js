// Decent Multi-Tenancy (c) 2014-2015 Bertrand Le Roy, under MIT license. See license.txt for licensing details.
'use strict';
var expect = require('chai').expect;
var proxyquire = require('proxyquire');

var EventEmitter = require('events').EventEmitter;
var path = require('path');
var IncomingMessage = require('http').IncomingMessage;
var ServerResponse = require('http').ServerResponse;

var Tenant = require('../lib/tenant');

describe('Tenant', function() {
  describe('empty', function() {

    it('is an instance of Tenant', function () {
      expect(Tenant.empty).to.be.an.instanceof(Tenant);
    });

    it('is named "Empty tenant"', function () {
      expect(Tenant.empty.name).to.equal('Empty tenant');
    });
  });

  describe('instance', function() {
    it('has default host, port, https flag, features, available modules, services, and manifests', function() {
      var tenant = new Tenant();

      expect(tenant.debugHost).to.deep.equal(['localhost']);
      expect(tenant.port).to.equal(80);
      expect(tenant.https).to.be.false;
      expect(tenant.features)
        .to.be.an.instanceof(Object)
        .and.to.be.empty;
    });

    it('is an event emitter', function() {
      expect(new Tenant()).to.be.an.instanceof(EventEmitter);
    });

    it('can load from a manifest file', function() {
      var stubs = {};
      stubs[path.join('path/to/site', 'settings.json')] = {
        name: 'Site 1',
        features: ['foo', 'bar'],
        '@noCallThru': true
      };
      var PhoniedTenant = proxyquire('../lib/tenant', stubs);
      var tenant = PhoniedTenant.load('path/to/site');

      expect(tenant.name).to.equal('Site 1');
      expect(tenant.features)
        .to.deep.equal(['foo', 'bar']);
    });

    it('uses defaults only when a property is missing from the manifest file', function() {
      var stubs = {};
      stubs[path.join('path/to/site', 'settings.json')] = {
        name: 'Site 1',
        '@noCallThru': true
      };
      var PhoniedTenant = proxyquire('../lib/tenant', stubs);
      var tenant = PhoniedTenant.load('path/to/site', {
        name: 'Default Name',
        host: 'Default Host'
      });

      expect(tenant.name).to.equal('Site 1');
      expect(tenant.host).to.deep.equal(['Default Host']);
    });

    it('can be discovered from the /sites folder', function() {
      var dir;
      var stubs = {
        fs: {
          readdirSync: function(dirPath) {
            dir = dirPath;
            return ['site1', 'site2'];
          }
        }
      };
      stubs[path.resolve('./sites/site1', 'settings.json')] = {
        name: 'Site 1',
        '@noCallThru': true
      };
      stubs[path.resolve('./sites/site2', 'settings.json')] = {
        name: 'Site 2',
        '@noCallThru': true
      };
      var PhoniedTenant = proxyquire('../lib/tenant', stubs);
      PhoniedTenant.discover();

      expect(PhoniedTenant.list['Site 1'])
        .to.have.property('name', 'Site 1');
      expect(PhoniedTenant.list['Site 2'])
        .to.have.property('name', 'Site 2');
    });

    it('is resolved by a host match on port 80', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 80,
          host: 'tenant1'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.not.be.ok;
      expect(resolvedTenant.debug).to.not.be.ok;
    });

    it('is resolved by a host match on port 443 if flagged https', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 443,
          https: true,
          host: 'tenant1'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.not.be.ok;
      expect(resolvedTenant.debug).to.not.be.ok;
    });

    it('is resolved by a host and port match', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 42,
          host: 'localhost'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'localhost:42';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.not.be.ok;
      expect(resolvedTenant.debug).to.not.be.ok;
    });

    it('is resolved by a host array and port match', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 42,
          host: ['host1', 'host2']
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'host1:42';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');

      req.headers.host = 'host2:42';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.not.be.ok;
      expect(resolvedTenant.debug).to.not.be.ok;
    });

    it('is resolved by a host, port, and path match', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 80,
          host: 'tenant1',
          path: '/sites/site1'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';
      req.url = '/sites/site1/path/page';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.not.be.ok;
      expect(resolvedTenant.debug).to.not.be.ok;
    });

    it('activates debug mode on debug host', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 80,
          host: 'production',
          debugHost: 'debug'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'debug';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant.name).to.equal('Site 1');
      expect(req.debug).to.be.ok;
      expect(resolvedTenant.debug).to.be.ok;
    });

    it('resolves to null if all tenants are disabled', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 80,
          host: 'tenant1'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';

      Tenant.list.site1.enable(false);
      Tenant.list.default.enable(false);
      var resolvedTenant = Tenant.resolve(req);
      expect(resolvedTenant).to.be.null;
      Tenant.list.site1.enable();
      resolvedTenant = Tenant.resolve(req);
      expect(resolvedTenant.name).to.equal('Site 1');
    });

    it('resolves to the only active tenant', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 80,
          host: 'tenant1'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';

      var resolvedTenant = Tenant.resolve(req);
      expect(resolvedTenant.name).to.equal('Site 1');
      Tenant.list.site1.enable(false);
      resolvedTenant = Tenant.resolve(req);
      expect(resolvedTenant.name).to.equal('Default tenant');
    });

    it('resolves to null when no match', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1',
          port: 43,
          host: 'tenant'
        })
      };
      Tenant.names = ['default', 'site1'];
      var req = new IncomingMessage();
      req.headers.host = 'tenant:42';
      var resolvedTenant = Tenant.resolve(req);

      expect(resolvedTenant).to.be.null;
    });

    it('can be disabled and enabled', function() {
      var tenant = new Tenant({active: false});
      expect(tenant.active).to.be.false;

      tenant = new Tenant({active: true});
      expect(tenant.active).to.be.true;

      tenant = new Tenant();
      expect(tenant.active).to.be.true;
      tenant.enable(false);
      expect(tenant.active).to.be.false;
      tenant.enable();
      expect(tenant.active).to.be.true;
      tenant.enable(false);
      expect(tenant.active).to.be.false;
      tenant.enable(true);
      expect(tenant.active).to.be.true;
    });

    it('can decide to handle requests using custom logic', function() {
      Tenant.list = {
        default: new Tenant({name: 'Default tenant'}),
        site1: new Tenant({
          name: 'Site 1'
        })
      };
      Tenant.names = ['default', 'site1'];
      Tenant.list.site1.canHandle = function() {
        return true;
      };
      var req = new IncomingMessage();
      req.headers.host = 'tenant1';

      var resolvedTenant = Tenant.resolve(req);
      expect(resolvedTenant.name).to.equal('Site 1');
    });

    it('can behave as middleware and handle requests', function(done) {
      var happened = [];
      var request = new IncomingMessage(80);
      request.headers.host = 'localhost';
      var response = new ServerResponse(request);
      var tenant = new Tenant();
      tenant.on(Tenant.startRequestEvent, function() {
        happened.push('start request');
      });
      tenant.on(Tenant.endRequestEvent, function() {
        happened.push('end request');
      });

      tenant.middleware(request, response, function() {
        expect(happened)
          .to.deep.equal([
            'start request',
            'end request'
          ]);
        done();
      });
    });
  });
});
