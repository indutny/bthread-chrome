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

ThreadManager.prototype.onMessage = function onMessage(msg) {
  if (!this.map[msg.host])
    return;

  var thread = this.map[msg.host];
  console.log(msg);
};

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

function Thread(manager, host, item) {
  this.manager = manager;
  this.host = host;
  this.item = item;

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
