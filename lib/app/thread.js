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
    self.show(input.val());
    input.val('');
  });

  this.port.onMessage.addListener(function(msg) {
    self.onMessage(msg);
  });

  this.postNew.click(function(e) {
    e.preventDefault();
    if (self.active)
      self.active.postForm.show();
  });

  this.passphrase = new PassphraseForm(this);
}
exports.ThreadManager = ThreadManager;

ThreadManager.prototype.add = function add(host, noStore) {
  if (this.map[host])
    return;

  var thread = new Thread(this, host);
  this.map[host] = thread;
  this.elem.append(thread.elem);

  if (noStore)
    return;

  this.port.postMessage({
    type: 'createThread',
    host: host
  });
};

ThreadManager.prototype.show = function show(thread, noStore) {
  if (typeof thread === 'string') {
    thread = this.map[thread];
    if (!thread)
      return;
  }
  if (this.active && this.active.host === thread.host)
    return;

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

  if (noStore)
    return;
  this.port.postMessage({
    type: 'showThread',
    host: thread.host
  });
};

ThreadManager.prototype.remove = function remove(thread, noStore) {
  if (typeof thread === 'string') {
    thread = this.map[thread];
    if (!thread)
      return;
  }
  if (!this.map[thread.host])
    return;
  if (this.active && this.map[thread.host] === this.active) {
    this.active.elem.removeClass('active');
    this.active.view.detach();
    this.active.postForm.elem.detach();
  }
  delete this.map[thread.host];

  thread.destroy();

  if (noStore)
    return;
  this.port.postMessage({
    type: 'removeThread',
    host: thread.host
  });
};

ThreadManager.prototype.onMessage = function onMessage(msg) {
  var type = msg.type;

  if (type === 'createThread') {
    this.add(msg.host, true);
    return;
  } else if (type === 'showThread') {
    this.show(msg.host, true);
    return;
  } else if (type === 'removeThread') {
    this.remove(msg.host, true);
    return;
  }

  if (!this.map[msg.host])
    return;

  var thread = this.map[msg.host];
  if (type === 'createDNS')
    thread.onCreateDNS(msg);
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

  // Every post's form will be listening for `wallet`
  this.setMaxListeners(10000);

  this.manager = manager;
  this.host = host;
  this.elem = this.manager.dummy.clone();

  // Map of wallet ids by name
  this.wallets = {};
  this.walletsById = {};

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

Thread.prototype.onCreateDNS = function onCreateDNS(msg) {
  var self = this;
  this.manager.passphrase.ask(msg.host, function(err, r) {
    if (err) {
      console.log(err);
      return;
    }
    self.manager.port.postMessage({
      type: 'cb',
      seq: msg.seq,
      data: { passphrase: r.passphrase }
    });
    self.cbs[msg.seq] = function(record) {
      console.log(record);
    };
  });
};

Thread.prototype.onSearch = function onSearch(msg) {
  if (msg.kind === 'owner') {
    if (!this.progress.search)
      this.progress.search = progress.get();
    this.progress.search.tick(msg.current, msg.total);
    if (msg.current === msg.total) {
      progress.release(this.progress.search);
      this.progress.search = null;
    }
  } else {
    var r = this.manager.passphrase.progress(msg.current, msg.total);
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
  if (msg.kind === 'owner') {
    this.wallet.owner = msg.addr;
    this.elem.removeClass('thread-item-loading');
  } else {
    var r = this.manager.passphrase.finish(msg);
    this.addWallet(r);
  }
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

Thread.prototype.addWallet = function addWallet(r) {
  if (this.wallets[r.name])
    return;

  this.wallets[r.name] = r;
  this.walletsById[r.id] = r;
  this.emit('wallet', r);
};

Thread.prototype.post = function post(walletId,
                                      replyTo,
                                      cost,
                                      content,
                                      confirm,
                                      cb) {
  var seq = this.seq += 2;

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
    walletId: walletId,
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
  this.manager = thread.manager;
  this.elem = this.manager.postForm.clone();

  this.toggle = toggle || $('<div class="collapse in" />');
  if (!toggle)
    this.elem.find('hr').remove();
  this.replyTo = replyTo;
  this.close = this.elem.find('.close'),
  this.select = this.elem.find('select');
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

  // Create new wallet button
  this.select.change(function() {
    if (self.select.val() === 'new') {
      self.select.attr('disabled', true);
      self.manager.passphrase.ask(self.thread.host, function() {
        self.select.attr('disabled', false);
      });
    }
  });

  // Add existing wallets
  Object.keys(this.thread.wallets).forEach(function(name) {
    this.addWallet(this.thread.wallets[name]);
  }, this);
  this.select.val('');

  // Add new wallets
  this.thread.on('wallet', function(r) {
    self.addWallet(r);
  });
}

PostForm.prototype.addWallet = function addWallet(r) {
  var opt = $('<option/>');
  opt.attr('value', r.id);
  opt.text(r.name);
  this.select.prepend(opt);
  if (!this.select.attr('disabled'))
    this.select.val(r.id);
};

PostForm.prototype.show = function show() {
  this.toggle.click();
};

PostForm.prototype.clearAlerts = function clearAlerts() {
  this.alerts.empty();
};

PostForm.prototype.alert = function alert(kind, txt, cb) {
  var elem = $('<div class="alert collapse in"/>');
  elem.addClass('alert-' + kind);
  elem.append($('<p/>').text(txt));
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

  elem.append($('<p/>').append(fld));
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
    var wallet = self.select.val() | 0;
    var walletAddr = self.thread.walletsById[wallet].addr;
    self.thread.post(wallet,
                     self.replyTo,
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
              ' BTC to the ' + walletAddr + ' address');
        self.thread.once('balance', post);
        return;
      } else if (err) {
        self.alert('danger', err.message);
        setTimeout(finish, 3500);
        return;
      }

      fields.cost.val('10000');
      fields.content.val('');
      finish();
      self.close.click();
    })
  }

  function finish() {
    // Close form and reset fields
    self.clearAlerts();
    fset.attr('disabled', false);
    btn.button('reset');
  }
};

function PassphraseForm(manager) {
  this.manager = manager;

  this.elem = $('#modal-passphrase');
  this.fields = {
    name: this.elem.find('input[name=name]'),
    pass: this.elem.find('input[name=passphrase]'),
    fld: this.elem.find('fieldset'),
    submit: this.elem.find('button[type=submit]'),
    progress: this.elem.find('.progress'),
    progressBar: this.elem.find('.progress-bar'),
    host: this.elem.find('.thread-modal-host')
  };

  this.host = null;
  this.name = null;
  this.pass = null;
  this.cb = null;
  this.queue = [];
  this.elem.modal('hide');

  var self = this;
  this.elem.find('form').submit(function(e) {
    e.preventDefault();

    self.fields.submit.button('loading');
    self.fields.fld.attr('disabled', true);
    self.fields.progress.removeClass('invisible');

    self.name = self.fields.name.val();
    self.pass = self.fields.pass.val();
    self.manager.port.postMessage({
      type: 'createWallet',
      host: self.host,
      passphrase: self.pass
    });
  });
};

PassphraseForm.prototype.ask = function ask(host, cb) {
  if (this.host !== null) {
    this.queue.push({ host: host, cb: cb });
    return;
  }

  this.fields.host.text(host);
  this.host = host;
  this.cb = cb;
  this.elem.modal('show');
};

PassphraseForm.prototype.progress = function progress(c, t) {
  this.fields.progressBar.css('width', (c / t) * 100 + '%');
};

PassphraseForm.prototype.finish = function finish(msg) {
  this.elem.modal('hide');

  // Reset form
  this.fields.fld.attr('disabled', false);
  this.fields.submit.button('reset');
  this.fields.name.val('');
  this.fields.pass.val('');
  this.fields.progressBar.css('width', '0');
  this.fields.progress.addClass('invisible');
  this.cb(null, this.name, msg.id);
  var res = {
    name: this.name,
    id: msg.id,
    addr: msg.addr,
    passphrase: this.pass
  };

  this.cb = null;
  this.name = null;
  this.host = null;

  // Ask queued question
  var q = this.queue.shift();
  if (q)
    this.ask(q.host, q.cb);

  return res;
};
