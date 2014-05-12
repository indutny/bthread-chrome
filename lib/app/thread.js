var progress = require('./progress');

function ThreadManager(port) {
  this.map = {};
  this.elem = $('#threads');
  this.dummy = this.elem.find('.thread-item:first');
  this.port = port;

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });
}
exports.ThreadManager = ThreadManager;

ThreadManager.prototype.add = function add(host) {
  if (this.map[host])
    return;

  var item = this.dummy.clone();
  var thread = new Thread(this, host, item);
  this.map[host] = thread;
  this.elem.append(item);

  this.port.postMessage({
    type: 'createThread',
    host: host
  });

  this.show(thread);
};

ThreadManager.prototype.show = function show(thread) {
};

ThreadManager.prototype.remove = function remove(thread) {
  if (!this.map[thread.host])
    return;
  delete this.map[thread.host];

  thread.item.remove();
  this.port.postMessage({
    type: 'removeThread',
    host: thread.host
  });
};

ThreadManager.prototype.onMessage = function onMessage(msg) {
  if (!this.map[msg.host])
    return;

  var thread = this.map[msg.host];
  var type = msg.type;

  if (type === 'dns-record')
    thread.onDNSRecord(msg);
  else if (type === 'search')
    thread.onSearch(msg);
  else if (type === 'balance')
    thread.onBalance(msg);
  else if (type === 'wallet')
    thread.onWallet(msg);
  else if (type === 'posts')
    thread.onPosts(msg);
  else if (type === 'update')
    thread.onUpdate(msg);
  else
    conosle.log(msg);
};

function Thread(manager, host, item) {
  this.manager = manager;
  this.host = host;
  this.item = item;
  this.progress = null;

  item.find('.thread-item-host').text(host).click(function(e) {
    manager.show(host);
  });

  var self = this;
  item.find('.thread-item-remove').click(function(e) {
    e.preventDefault();
    manager.remove(self);
  });
};

Thread.prototype.show = function show() {
  this.manager.show(this);
};

Thread.prototype.remove = function remove() {
  this.manager.remove(this);
};

Thread.prototype.onDNSRecord = function onDNSRecord(msg) {
};

Thread.prototype.onSearch = function onSearch(msg) {
  if (!this.progress)
    this.progress = progress.get();
  this.progress.tick(msg.current, msg.total);
  if (msg.current === msg.total) {
    progress.release(this.progress);
    this.progress = null;
  }
};

Thread.prototype.onBalance = function onBalance(msg) {
};

Thread.prototype.onWallet = function onWallet(msg) {
};

Thread.prototype.onPosts = function onPosts(msg) {
};

Thread.prototype.onUpdate = function onUpdate(msg) {
};
