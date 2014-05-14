var thread = require('./thread');
var bn = require('bn.js');
var bcoin = require('bcoin');

chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('app.html', {
    id: 'BThread',
    bounds: {
      width: 800,
      height: 600
    },
    minWidth: 800,
    minHeight: 600,
    maxHeight: 600
  });
});

var port = chrome.runtime.onConnect.addListener(function(port) {
  new Client(port);
});

function Client(port) {
  this.port = port;
  this.passphrase = null;
  this.threads = {};
  this.cbs = {};

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });

  this.port.onDisconnect.addListener(function() {
    self.onDisconnect();
  });
}

Client.prototype.onMessage = function onMessage(msg) {
  if (msg.type === 'passphrase') {
    this.passphrase = msg.passphrase;
  } else if (msg.type === 'createThread') {
    this.createThread(msg);
  } else if (msg.type === 'removeThread') {
    this.removeThread(msg);
  } else if (msg.type === 'post') {
    this.post(msg);
  } else if (msg.type === 'cb') {
    var cb = this.cbs[msg.seq];
    delete this.cbs[msg.seq];
    cb(msg.data);
  }
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

  var lastPercent = 0;
  t.on('chain-progress', function(percent) {
    percent *= 100;
    if (percent - lastPercent < 2)
      return;
    lastPercent = percent;

    self.port.postMessage({
      type: 'chain-progress',
      host: host,
      percent: percent
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

  t.on('update', function(post) {
    self.port.postMessage({
      type: 'update',
      host: host,
      post: post
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
  }
};

Client.prototype.removeThread = function removeThread(msg) {
  if (!this.threads[msg.host])
    return;

  this.threads[msg.host].close();
  delete this.threads[msg.host];
};

Client.prototype.post = function post(msg) {
  if (!this.threads[msg.host])
    return;

  var self = this;

  this.threads[msg.host].post(new bn(msg.cost), msg.post, confirm, done);
  function confirm(out, fee, cb) {
    self.cbs[msg.seq] = function(msg) {
      cb(msg.result);
    };

    self.port.postMessage({
      type: 'cb',
      host: msg.host,
      seq: msg.seq,
      data: {
        type: 'confirm',
        out: bcoin.utils.toBTC(out),
        fee: bcoin.utils.toBTC(fee)
      }
    });
  }

  function done(err, status, hash) {
    if (err && err.minBalance)
      err.minBalance = err.minBalance.toString(10);
    self.port.postMessage({
      type: 'cb',
      host: msg.host,
      seq: msg.seq,
      data: {
        type: 'done',
        err: err,
        status: status,
        hash: hash
      }
    });
  }
};
