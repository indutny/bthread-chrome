var progress = require('./progress');
var marked = require('marked');
var inherits = require('inherits');
var bn = require('bn.js');
var utils = require('./utils');
var EventEmitter = require('events').EventEmitter;

function ThreadManager(port) {
  this.map = {};
  this.elem = $('#threads');
  this.navHost = $('.thread-title-host');
  this.addForm = $('#thread-add');
  this.sidebar = $('.sidebar');
  this.dummy = this.elem.find('.thread-item:first');
  this.postContainer = $('.thread-post-container');
  this.postNew = $('#thread-post');
  this.postForm = $('.thread-post-form');
  this.postDummy = this.postContainer.find('.thread-post:first');
  this.port = port;
  this.active = null;

  var self = this;
  this.addForm.submit(function(e) {
    e.preventDefault();

    // Show sidebar for 750 ms
    self.sidebar.addClass('thread-sidebar-open');
    setTimeout(function() {
      self.sidebar.removeClass('thread-sidebar-open');
    }, 750);

    // Create/load new thread
    var input = self.addForm.find('input');
    self.add(input.val());
    input.val('');
  });

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

  this.postNew.click(function(e) {
    e.preventDefault();
    if (self.active)
      self.active.postForm.show();
  });
}
exports.ThreadManager = ThreadManager;

ThreadManager.prototype.add = function add(host) {
  if (this.map[host])
    return;

  var thread = new Thread(this, host);
  this.map[host] = thread;
  this.elem.append(thread.elem);

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
    this.active.elem.removeClass('active');
    this.active.view.detach();
    this.active.postForm.elem.detach();
  }
  this.active = thread;
  this.navHost.text('/ ' + thread.host);
  this.active.elem.addClass('active');
  this.postContainer.empty()
                    .append(this.active.postForm.elem)
                    .append(this.active.view);

  var st = {};
  st[this.prefix + 'active'] = thread.host;
  chrome.storage.local.set(st);
};

ThreadManager.prototype.remove = function remove(thread) {
  if (!this.map[thread.host])
    return;
  if (this.active && this.map[thread.host] === this.active) {
    this.active.elem.removeClass('active');
    this.active.view.detach();
    this.active.postForm.elem.detach();
  }
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
  else if (type === 'chain-progress')
    thread.onChainProgress(msg);
  else if (type === 'balance')
    thread.onBalance(msg);
  else if (type === 'wallet')
    thread.onWallet(msg);
  else if (type === 'posts')
    thread.onPosts(msg);
  else if (type === 'update')
    thread.onUpdate(msg);
  else if (type === 'cb')
    thread.onCb(msg);
  else
    console.log(msg);
};

function Thread(manager, host) {
  EventEmitter.call(this);

  this.manager = manager;
  this.host = host;
  this.elem = this.manager.dummy.clone();

  this.progress = {
    search: null,
    chain: null
  };
  this.balance = '0';
  this.wallet = {};

  this.view = $('<div class=thread-view />');
  this.posts = {
    top: [],
    all: {},
    orphans: {}
  };

  // Sequence number of communications
  this.seq = 0;
  this.cbs = {};

  var self = this;
  this.elem.find('.thread-item-host').text(host).click(function(e) {
    manager.show(self);
  });

  this.elem.find('.thread-item-remove').click(function(e) {
    e.preventDefault();
    manager.remove(self);
  });

  this.postForm = new PostForm(this);
};
inherits(Thread, EventEmitter);

Thread.prototype.show = function show() {
  this.manager.show(this);
};

Thread.prototype.remove = function remove() {
  this.manager.remove(this);
};

Thread.prototype.destroy = function destroy() {
  this.elem.remove();
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
    var index = binaryInsert(this.posts.top, post, replyCmp);
    if (index === 0)
      this.view = this.view.prepend(post.elem);
    else
      this.posts.top[index - 1].elem.after(post.elem);
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
  if (!this.progress.search)
    this.progress.search = progress.get();
  this.progress.search.tick(msg.current, msg.total);
  if (msg.current === msg.total) {
    progress.release(this.progress.search);
    this.progress.search = null;
  }
};

Thread.prototype.onChainProgress = function onChainProgress(msg) {
  if (!this.progress.chain)
    this.progress.chain = progress.get();
  this.progress.chain.tick(msg.percent, 100);
  if (msg.percent === 1) {
    progress.release(this.progress.chain);
    this.progress.chain = null;
  }
};

Thread.prototype.onBalance = function onBalance(msg) {
  this.balance = msg.value;
  this.emit('balance', this.balance);
};

Thread.prototype.onWallet = function onWallet(msg) {
  this.wallet[msg.kind] = msg.addr;
  this.elem.removeClass('thread-item-loading');
  if (this.wallet.self === this.wallet.owner)
    this.elem.find('.thread-item-owner').removeClass('invisible');
};

Thread.prototype.onPosts = function onPosts(msg) {
  msg.list.forEach(function(post) {
    this.addPost(post);
  }, this);
};

Thread.prototype.onUpdate = function onUpdate(msg) {
  this.addPost(msg.post);
};

Thread.prototype.onCb = function onCb(msg) {
  var cb = this.cbs[msg.seq];
  delete this.cbs[msg.seq];
  cb(msg.data);
};

Thread.prototype.post = function post(replyTo, cost, content, confirm, cb) {
  var seq = this.seq++;

  var self = this;
  this.cbs[seq] = function(msg) {
    if (msg.type === 'done')
      return cb(msg.err, msg.status, msg.hash);

    confirm(msg.out, msg.fee, function onconfirm(res) {
      self.cbs[seq] = function ondone(res) {
        cb(res.err, res.status, res.hash);
      };

      self.manager.port.postMessage({
        type: 'cb',
        host: this.host,
        seq: seq,
        data: {
          result: res
        }
      });
    });
  };

  this.manager.port.postMessage({
    type: 'post',
    host: this.host,
    cost: cost,
    seq: seq,
    post: {
      replyTo: replyTo,
      content: content
    }
  });
}

function Post(thread, post) {
  this.thread = thread;
  this.elem = thread.manager.postDummy.clone().removeClass('hidden');
  this.data = post;

  this.hash = this.data.hash;
  this.replyTo = this.data.replyTo;
  this.ts = this.data.ts;

  var authorBadge = this.elem.find('.thread-post-author');
  var author;
  if (this.data.author === 'owner') {
    authorBadge.addClass('owner').text('owner');
  } else if (this.data.author) {
    authorBadge.text('by ' + this.data.author.slice(0, 8) + '\u2026');
  } else {
    authorBadge.text('by unknown');
  }

  this.title = this.elem.find('.thread-post-title a');
  this.collapse = this.elem.find('.panel-collapse');
  this.reply = {
    toggle: this.elem.find('.thread-post-reply-toggle'),
    container: this.elem.find('.thread-post-replies'),
    form: null,
    list: [],
    map: {}
  };

  // Create and add reply form
  this.reply.form = new PostForm(this.thread, this.reply.toggle, this.hash);
  this.elem.find('.thread-post-form-container').append(this.reply.form.elem);

  if (post.title)
    this.title.text(post.title);
  else
    this.title.hide();
  this.title.attr('title', this.hash);

  var content = post.content;

  // Strip title
  if (post.title && content.indexOf('# ' + post.title + '\n') === 0)
    content = content.slice(2 + post.title.length + 1);
  else if (post.title && content.indexOf(post.title + '\n') === 0)
    content = content.slice(post.title.length + 1);
  post.content = content;

  // Set content
  this.elem.find('.thread-post-content').html(marked(content));

  // Collapse replies by default
  if (this.replyTo)
    this.collapse.collapse('hide');

  // Show replies by click on title
  var self = this;
  this.title.click(function(e) {
    e.preventDefault();
    self.collapse.collapse('toggle');
  });

  // Add replies
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
    this.reply.container.prepend(reply.elem);
  else
    this.reply.list[index - 1].elem.after(reply.elem);
};

function PostForm(thread, toggle, replyTo) {
  this.thread = thread;
  this.elem = thread.manager.postForm.clone();

  this.toggle = toggle || $('<div class="collapse in" />');
  if (!toggle)
    this.elem.find('hr').remove();
  this.replyTo = replyTo;
  this.close = this.elem.find('.close'),
  this.alerts = this.elem.find('.thread-post-form-alerts');

  // Show post form by click on the link
  var formVisible = false;
  var self = this;
  this.toggle.click(function(e) {
    e.preventDefault();
    if (formVisible)
      return;
    formVisible = true;
    self.toggle.collapse('hide').one('hidden.bs.collapse', function() {
      self.elem.collapse('show');
    });
  });
  this.close.click(function(e) {
    e.preventDefault();
    if (!formVisible)
      return;
    formVisible = false;
    self.elem.collapse('hide').one('hidden.bs.collapse', function() {
      self.toggle.collapse('show');
    });
  });

  // Send post
  this.elem.submit(function(e) {
    e.preventDefault();
    self.send();
  });
}

PostForm.prototype.show = function show() {
  this.toggle.click();
};

PostForm.prototype.clearAlerts = function clearAlerts() {
  this.alerts.empty();
};

PostForm.prototype.alert = function alert(kind, txt, cb) {
  var elem = $('<div class="alert collapse in"/>');
  elem.addClass('alert-' + kind);
  elem.text(txt);
  elem.alert();
  elem.hide();

  if (!cb)
    return this.alerts.prepend(elem.fadeIn());

  // Add confirmation and rejection buttons
  var fld = $('<fieldset/>');
  function btn(kind, text, res) {
    var b = $('<button type="button"/>');
    b.addClass('btn btn-' + kind).text(text);
    b.click(function(e) {
      e.preventDefault();
      fld.attr('disabled', true);
      done(res);
    });
    fld.append(b);
  }

  elem.append(fld);
  btn('primary', 'Confirm', true);
  btn('warning', 'Reject', false);

  function done(res) {
    elem.one('closed.bs.alert', function() {
      cb(res);
    }).alert('close');
  }

  this.alerts.prepend(elem.fadeIn());
};

PostForm.prototype.send = function send() {
  var fields = {
    cost: this.elem.find('.thread-post-form-cost'),
    content: this.elem.find('.thread-post-form-content')
  };

  var fset = this.elem.find('> fieldset');
  fset.attr('disabled', true);
  var btn = this.elem.find('button[type=submit]')
  btn.button('loading');

  var cost = fields.cost.val();
  var content = fields.content.val();

  var self = this;
  post();
  function post() {
    self.clearAlerts();
    self.thread.post(self.replyTo,
                     cost,
                     content,
                     function confirm(out, fee, cb) {
      self.alert(
        'info',
        'Going to post a message with value ' + out + ' BTC and fee ' + fee +
            ' BTC',
        cb);
    }, function done(err, status, hash) {
      if (err && err.minBalance) {
        var b = new bn(err.minBalance, 10);
        b = b.sub(new bn(self.thread.balance, 10));

        self.alert(
          'warning',
          'Not enough balance, please transfer ' + utils.toBTC(b) +
              ' BTC to the ' + self.thread.wallet.self + ' address');
        self.thread.once('balance', post);
        return;
      } else if (err) {
        console.error(err);
        finish();
        return;
      }

      finish();
      self.close.click();
    })
  }

  function finish() {
    // Close form and reset fields
    self.clearAlerts();
    fset.attr('disabled', false);
    btn.button('reset');
    fields.cost.val('10000');
    fields.content.val('');
  }
};
