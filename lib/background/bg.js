var thread = require('./thread');
var ThreadPool = require('./tpool');
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
var tpool = new ThreadPool();

function Client(port) {
  this.port = port;
  this.seq = 1;
  this.cbs = {};
  this.listenerMap = {};
  this.threads = {};
  this.wallets = {};

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });
  this.port.onDisconnect.addListener(function() {
    self.onDisconnect();
  });

  this._tpoolAdd = function tpoolAdd(host) {
    self.port.postMessage({ type: 'createThread', host: host });
    self.createThread({ host: host });
  };
  this._tpoolShow = function tpoolShow(host) {
    self.port.postMessage({ type: 'showThread', host: tpool.active });
  };
  this._tpoolRemove = function tpoolRemove(host) {
    self.port.postMessage({ type: 'removeThread', host: tpool.active });
    self.removeThread({ host: host });
  };
  tpool.on('create', this._tpoolAdd);
  tpool.on('show', this._tpoolShow);
  tpool.on('remove', this._tpoolRemove);

  // Open threads and select active
  Object.keys(tpool.map).forEach(function(host) {
    self._tpoolAdd(host);
  });
  if (tpool.active)
    this._tpoolShow(tpool.active);
}

Client.prototype.onMessage = function onMessage(msg) {
  if (msg.type === 'createThread') {
    this.createThread(msg);
  } else if (msg.type === 'showThread') {
    // Just to remember last thread
    tpool.show(msg.host);
  } else if (msg.type === 'removeThread') {
    this.removeThread(msg);
  } else if (msg.type === 'createWallet') {
    this.createWallet(msg);
  } else if (msg.type === 'post') {
    this.post(msg);
  } else if (msg.type === 'cb') {
    var cb = this.cbs[msg.seq];
    delete this.cbs[msg.seq];
    cb(msg.data);
  }
};

Client.prototype._addListener = function _addListener(host, t, ev, cb, once) {
  if (once)
    t.once(ev, cb);
  else
    t.on(ev, cb);

  if (!this.listenerMap[host])
    this.listenerMap[host] = [];
  this.listenerMap[host].push({ t: t, ev: ev, cb: cb });
};

Client.prototype._removeListeners = function _removeListeners(host) {
  if (!this.listenerMap[host])
    return;
  var list = this.listenerMap[host];
  delete this.listenerMap[host];

  list.forEach(function(item) {
    item.t.removeListener(item.ev, item.cb);
  });
};

Client.prototype.onDisconnect = function onDisconnect() {
  Object.keys(this.threads).forEach(function(host) {
    this.removeThread({ host: host });
  }, this);

  tpool.removeListener('create', this._tpoolAdd);
  tpool.removeListener('show', this._tpoolShow);
  tpool.removeListener('remove', this._tpoolRemove);
};

Client.prototype.createThread = function createThread(msg) {
  var host = msg.host;
  if (this.threads[host])
    return;
  var t = tpool.create(host);
  this.threads[host] = t;
  this.wallets[host] = [];

  var self = this;
  if (t.createDNSCb) {
    sendDNSCb(t.createDNSCb);
  } else {
    this._addListener(host, t, 'create-dns', sendDNSCb);
  }
  function sendDNSCb(cb) {
    var seq = self.seq += 2;
    self.port.postMessage({
      type: 'createDNS',
      host: host,
      seq: seq
    });
    self.cbs[seq] = function(msg) {
      cb(msg.passphrase, function(r) {
        self.port.postMessage({
          type: 'cb',
          host: host,
          seq: seq,
          data: {
            record: r
          }
        });
      });
    };
  }

  var lastPercent = 0;
  this._addListener(host, t, 'chain-progress', function(percent) {
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

  this._addListener(host, t, 'search', function(current, total) {
    self.port.postMessage({
      type: 'search',
      host: host,
      kind: 'owner',
      current: current,
      total: total
    });
  });

  if (t.wallet) {
    this.port.postMessage({
      type: 'wallet',
      kind: 'owner',
      host: host,
      addr: t.wallet.getAddress()
    });
  } else {
    this._addListener(host, t, 'wallet', function(addr) {
      self.port.postMessage({
        type: 'wallet',
        kind: 'owner',
        host: host,
        addr: addr
      });
    });
  }

  this._addListener(host, t, 'update', function(post) {
    self.port.postMessage({
      type: 'update',
      host: host,
      post: post
    });
  });

  if (t.loaded)
    onLoad();
  else
    this._addListener(host, t, 'load', onLoad, true);
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

  this._removeListeners(msg.host);
  delete this.threads[msg.host];
  this.wallets[msg.host].slice().forEach(function(w) {
    thread.pool.removeWallet(w);
  }, this);
  delete this.wallets[msg.host];
  tpool.remove(msg.host);
};

Client.prototype.createWallet = function createWallet(msg) {
  if (!this.threads[msg.host])
    return;

  var host = msg.host;
  var pass = msg.passphrase;
  var w = new bcoin.wallet({
    scope: host,
    passphrase: pass,
    storage: thread.db
  });
  var id = this.wallets[host].push(w) - 1;

  var pool = thread.pool;
  var self = this;
  var e = pool.addWallet(w);

  if (msg.noWait) {
    done();
  } else {
    e.on('progress', function(c, t) {
      self.port.postMessage({
        type: 'search',
        host: host,
        kind: 'self',
        id: id,
        current: c,
        total: t
      });
    });
    e.once('end', done);
  }

  function done() {
    self.port.postMessage({
      type: 'wallet',
      kind: 'self',
      host: host,
      addr: w.getAddress(),
      id: id
    });
  }
};

Client.prototype.post = function post(msg) {
  if (!this.threads[msg.host])
    return;
  var self = this;
  var w = this.wallets[msg.host][msg.walletId];
  if (!w)
    return;

  this.threads[msg.host].post(w, new bn(msg.cost), msg.post, confirm, done);

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
        err: err && { message: err.message, minBalance: err.minBalance },
        status: status,
        hash: hash
      }
    });
  }
};
