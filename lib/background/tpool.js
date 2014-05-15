var thread = require('./thread');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

function ThreadPool() {
  EventEmitter.call(this);

  this.map = {};
  this.active = null;

  this.prefix = 'bt/thread/';

  var self = this;
  chrome.storage.local.get(function(obj) {
    Object.keys(obj).forEach(function(key) {
      var match = key.match(/^bt\/thread\/(.*)$/);
      if (!match)
        return;

      if (match[1] === 'active')
        self.active = obj[key];
      else
        self.create(match[1], true);
    });
  });
};
inherits(ThreadPool, EventEmitter);

module.exports = ThreadPool;

ThreadPool.prototype.create = function create(host, noRef) {
  if (!this.map[host]) {
    this.map[host] = { thread: thread.create(host), ref: 1 };
    this.emit('create', host);
  } else {
    this.map[host].ref++;
  }

  if (noRef) {
    this.map[host].ref--;
  } else {
    var st = {};
    st[this.prefix + host] = 1;
    chrome.storage.local.set(st);
  }

  // Send all thread events to the page
  return this.map[host].thread;
};

ThreadPool.prototype.remove = function remove(host) {
  if (!this.map[host])
    return;
  if (--this.map[host].ref !== 0)
    return;

  this.map[host].thread.close();
  delete this.map[host];
  chrome.storage.local.remove(this.prefix + thread.host);
  this.emit('remove', host);
  return true;
};

ThreadPool.prototype.show = function show(host) {
  if (!this.map[host])
    return;
  if (this.active === host)
    return;

  var st = {};
  st[this.prefix + 'active'] = host;

  this.active = host;
  chrome.storage.local.set(st);
  this.emit('show', host);
};
