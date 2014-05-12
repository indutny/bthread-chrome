var thread = require('./thread');
var bn = require('bn.js');

chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('app.html', {
    id: 'BThread',
    bounds: {
      width: 800,
      height: 600,
      left: 100,
      top: 100
    },
    minWidth: 800,
    minHeight: 600
  });
});

var port = chrome.runtime.onConnect.addListener(function(port) {
  new Client(port);
});

function Client(port) {
  this.port = port;
  this.passphrase = null;
  this.threads = {};

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });

  this.port.onDisconnect.addListener(function() {
    self.onDisconnect();
  });
}

Client.prototype.onMessage = function onMessage(msg) {
  if (msg.type === 'passphrase')
    this.passphrase = msg.passphrase;
  else if (msg.type === 'createThread')
    this.createThread(msg);
  else if (msg.type === 'removeThread')
    this.removeThread(msg);
};

Client.prototype.onDisconnect = function onDisconnect() {
  Object.keys(this.threads).forEach(function(host) {
    this.threads[host].close();
  }, this);
};

Client.prototype.createThread = function createThread(msg) {
  var host = msg.host;
  if (!this.threads[host])
    this.threads[host] = thread.create(host, this.passphrase);

  // Send all thread events to the page
  var self = this;
  var t = this.threads[msg.host];

  t.on('dns-record', function(rec) {
    self.port.postMessage({
      type: 'dns-record',
      host: host,
      record: rec
    });
  });

  t.on('search', function(range, current, total) {
    self.port.postMessage({
      type: 'search',
      host: host,
      range: range,
      current: current,
      total: total
    });
  });

  t.on('balance', function() {
    self.port.postMessage({
      type: 'balance',
      host: host,
      value: t.balance.toString(10)
    });
  });

  t.on('wallet', function(addr, kind) {
    self.port.postMessage({
      type: 'wallet',
      host: host,
      kind: kind,
      addr: addr
    });
  });

  if (t.loaded)
    onLoad();
  else
    t.once('load', onLoad);
  function onLoad() {
    self.port.postMessage({
      type: 'posts',
      host: host,
      list: t.list()
    });

    // Emit updates only after emitting posts themselves
    t.on('update', function(post) {
      self.port.postMessage({
        type: 'update',
        host: host,
        post: post
      });
    });
  }
};

Client.prototype.removeThread = function removeThread(msg) {
  if (!this.threads[msg.host])
    return;

  this.threads[msg.host].close();
  delete this.threads[msg.host];
};
