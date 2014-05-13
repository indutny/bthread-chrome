var progress = require('./progress');
var marked = require('marked');

function ThreadManager(port) {
  this.map = {};
  this.elem = $('#threads');
  this.dummy = this.elem.find('.thread-item:first');
  this.postContainer = $('.thread-post-container');
  this.postDummy = this.postContainer.find('.thread-post:first');
  this.port = port;
  this.active = null;

  var self = this;
  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });

  this.prefix = 'bt/thread/';
  chrome.storage.local.get(function(obj) {
    Object.keys(obj).forEach(function(key) {
      var match = key.match(/^bt\/thread\/(.*)$/);
      if (!match)
        return;

      if (match[1] !== 'active')
        self.add(match[1]);
    });

    // Restore last active
    if (obj[self.prefix + 'active']) {
      var host = obj[self.prefix + 'active'];
      if (!self.map[host])
        return;

      self.show(self.map[host]);
    }
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
  var st = {};
  st[this.prefix + host] = 1;
  chrome.storage.local.set(st);

  this.show(thread);
};

ThreadManager.prototype.show = function show(thread) {
  if (this.active) {
    this.active.item.removeClass('active');
    this.active.view.detach();
  }
  this.active = thread;
  this.active.item.addClass('active');
  this.postContainer.empty().append(this.active.view);

  var st = {};
  st[this.prefix + 'active'] = thread.host;
  chrome.storage.local.set(st);
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
  chrome.storage.local.remove(this.prefix + thread.host);
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
    all: {},
    orphans: {}
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

  post = new Post(this, post);

  // Nested post, i.e. comment
  if (post.replyTo) {
    var parent = this.posts.all[post.replyTo];
    if (parent)
      parent.addReply(post);
    else if (this.posts.orphans[post.replyTo])
      this.posts.orphans[post.replyTo].push(post);
    else
      this.posts.orphans[post.replyTo] = [ post ];

  // Add top-level post
  } else {
    this.posts.top[post.hash] = post;
    this.view.append(post.item);
  }

  this.posts.all[post.hash] = post;

  // Fullfill orphans
  var orphans = this.posts.orphans[post.hash];
  delete this.posts.orphans[post.hash];
  if (orphans) {
    orphans.forEach(function(orphan) {
      post.addReply(orphan);
    });
  }
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

function Post(thread, post) {
  this.thread = thread;
  this.item = thread.manager.postDummy.clone().removeClass('hidden');
  this.data = post;

  this.hash = this.data.hash;
  this.replyTo = this.data.replyTo;
  this.ts = this.data.ts;

  var authorBadge = this.item.find('.thread-post-author');
  var author;
  if (this.data.author === 'owner') {
    authorBadge.addClass('owner').text('owner');
  } else if (this.data.author) {
    authorBadge.text('by ' + this.data.author.slice(0, 8) + '\u2026');
  } else {
    authorBadge.text('by unknown');
  }

  this.title = this.item.find('.thread-post-title a');
  this.collapse = this.item.find('.panel-collapse');
  this.reply = {
    toggle: this.item.find('.thread-post-reply-toggle'),
    formClose: this.item.find('.thread-post-reply-form > .close'),
    container: this.item.find('.thread-post-replies'),
    form: this.item.find('.thread-post-reply-form'),
    list: [],
    map: {}
  };

  if (post.title)
    this.title.text(post.title);
  else
    this.title.hide();

  var content = post.content;

  // Strip title
  if (post.title && content.indexOf('# ' + post.title + '\n') === 0)
    content = content.slice(2 + post.title.length + 1);
  else if (post.title && content.indexOf(post.title + '\n') === 0)
    content = content.slice(post.title.length + 1);
  post.content = content;

  // Set content
  this.item.find('.thread-post-content').html(marked(content));

  // Collapse replies by default
  if (this.replyTo)
    this.collapse.collapse('hide');

  // Show replies by click on title
  var self = this;
  this.title.click(function(e) {
    e.preventDefault();
    self.collapse.collapse('toggle');
  });

  // Show reply form by click on link
  this.reply.toggle.click(function(e) {
    e.preventDefault();
    self.reply.toggle.collapse('hide').one('hidden.bs.collapse', function() {
      self.reply.form.collapse('show');
    });
  });
  this.reply.formClose.click(function(e) {
    e.preventDefault();
    self.reply.form.collapse('hide').one('hidden.bs.collapse', function() {
      self.reply.toggle.collapse('show');
    });
  });

  if (this.data.replies) {
    this.data.replies.map(function(reply) {
      this.addReply(new Post(thread, reply));
    }, this);
  }
}

function binaryInsert(list, item, compare, search) {
  var start = 0,
      end = list.length;

  while (start < end) {
    var pos = (start + end) >> 1;
    var cmp = compare(item, list[pos]);

    if (cmp === 0) {
      start = pos;
      end = pos;
      break;
    } else if (cmp < 0) {
      end = pos;
    } else {
      start = pos + 1;
    }
  }

  if (!search)
    list.splice(start, 0, item);
  return start;
}

function replyCmp(a, b) {
  return b.ts - a.ts;
}

Post.prototype.addReply = function addReply(reply) {
  if (this.reply.map[reply.hash])
    return;
  this.reply.map[reply.hash] = reply;

  var index = binaryInsert(this.reply.list, reply, replyCmp);
  if (index === 0)
    this.reply.container.prepend(reply.item);
  else
    this.reply.list[index - 1].item.after(reply.item);
};

