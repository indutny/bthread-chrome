var progress = require('./progress');
var marked = require('marked');

function ThreadManager(port) {
  this.map = {};
  this.elem = $('#threads');
  this.dummy = this.elem.find('.thread-item:first');
  this.postContainer = $('.post-container');
  this.postDummy = this.postContainer.find('.thread-post:first');
  this.port = port;
  this.active = null;

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });
}
exports.ThreadManager = ThreadManager;

ThreadManager.prototype.add = function add(host) {
  if (this.map[host])
    return;

  var thread = new Thread(this, host);
  this.map[host] = thread;
  this.elem.append(thread.item);

  this.port.postMessage({
    type: 'createThread',
    host: host
  });

  this.show(thread);
};

ThreadManager.prototype.show = function show(thread) {
  if (this.active)
    this.active.item.removeClass('active');
  this.active = thread;
  this.active.item.addClass('active');
  this.postContainer.html(this.active.view);
};

ThreadManager.prototype.remove = function remove(thread) {
  if (!this.map[thread.host])
    return;
  delete this.map[thread.host];

  thread.destroy();
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

function Thread(manager, host) {
  this.manager = manager;
  this.host = host;
  this.item = this.manager.dummy.clone();
  this.progress = null;

  this.view = $('<span/>');
  this.posts = {
    top: {},
    all: {}
  };

  var self = this;
  this.item.find('.thread-item-host').text(host).click(function(e) {
    manager.show(self);
  });

  this.item.find('.thread-item-remove').click(function(e) {
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

Thread.prototype.destroy = function destroy() {
  this.item.remove();
  this.view.remove();
};

Thread.prototype.addPost = function addPost(post) {
  if (this.posts.all[post.hash]) {
    // Process replies anyway
    if (!post.replies)
      return;
    post.replies.forEach(function(post) {
      this.addPost(post);
    }, this);
    return;
  }

  var item = this.manager.postDummy.clone().removeClass('hidden');
  if (post.title)
    item.find('.panel-title').text(post.title);
  else
    item.find('.panel-title').hide();

  var content = post.content;

  // Strip title
  if (post.title && content.indexOf('# ' + post.title + '\n') === 0)
    content = content.slice(2 + post.title.length + 1);

  item.find('> .panel-body > .thread-post-content').html(marked(content));

  // Nested post, i.e. comment
  if (post.replyTo) {
    var parent = this.posts.all[post.replyTo];
    if (!parent)
      return;

    parent.find('> .panel-body > .comments').append(item);

  // Add top-level post
  } else {
    this.posts.top[post.hash] = item;
    this.view.append(item);
  }

  this.posts.all[post.hash] = item;

  // Add replies
  if (!item.replies)
    return;
  item.replies.forEach(function(post) {
    this.addPost(post);
  }, this);
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
  msg.list.forEach(function(post) {
    this.addPost(post);
  }, this);
};

Thread.prototype.onUpdate = function onUpdate(msg) {
  this.addPost(msg.post);
};
