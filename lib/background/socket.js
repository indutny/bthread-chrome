var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

var sockets = {};

chrome.sockets.tcp.onReceive.addListener(function(info) {
  var socket = sockets[info.socketId];
  if (!socket)
    return;

  var raw = new Uint8Array(info.data);
  socket.emit('data', raw);
});

chrome.sockets.tcp.onReceiveError.addListener(function(info) {
  var socket = sockets[info.socketId];
  if (!socket)
    return;

  socket._error('Receive error: ' + info.resultCode);
});

function Socket() {
  EventEmitter.call(this);

  this.socket = null;
  this.connected = false;
  this.writing = false;

  this.writeQueue = [];

  var self = this;
  chrome.sockets.tcp.create(function(info) {
    sockets[info.socketId] = self;
    self.socket = info.socketId;
    self.emit('socket');
  });

  this.setMaxListeners(Infinity);
}
inherits(Socket, EventEmitter);

Socket.prototype._error = function _error(msg) {
  this.emit('error', new Error(msg + ' ' + chrome.runtime.lastError));
};

Socket.prototype.connect = function connect(port, host) {
  if (this.socket === null) {
    this.once('socket', function() {
      this.connect(port, host);
    });
    return;
  }

  if (this.connected)
    return this.emit('error', new Error('Already connected'));

  var self = this;
  chrome.sockets.tcp.connect(this.socket, host, port, function(res) {
    if (res < 0)
      return self._error('Connection failed: ' + res);

    self.connected = true;
    self.emit('connect');
  });
};

Socket.prototype.destroy = function destroy() {
  if (this.socket === null) {
    this.once('socket', function() {
      this.destroy();
    });
    return;
  }

  var self = this;
  var socket = this.socket;
  this.socket = null;

  if (this.connected)
    chrome.sockets.tcp.disconnect(socket, close);
  else
    close();
  this.connected = false;

  function close() {
    chrome.sockets.tcp.close(socket, function() {
      delete sockets[socket];
      self.emit('close');
      self.emit('end');
    });
  }
};

Socket.prototype.write = function write(data, enc, cb) {
  if (!this.connected) {
    this.once('connect', function() {
      this.write(data, enc, cb);
    });
    return;
  }
  if (this.writing) {
    this.writeQueue.push({ data: data, enc: enc, cb: cb });
    return;
  }

  this.writing = true;
  var self = this;
  var off = 0;
  send();
  function send() {
    if (Array.isArray(data)) {
      var chunk = new Uint8Array(data.slice(off));
    } else {
      var chunk = new Uint8Array(data.length - off);
      for (var i = off; i < data.length; i++)
        chunk[i] = data.charCodeAt(i) & 0xff;
    }

    if (!self.connected)
      return self.emit('error', new Error('EPIPE'));

    if (!self.socket)
      return self.emit('error', new Error('Write after end'));

    chrome.sockets.tcp.send(self.socket, chunk.buffer, function(info) {
      if (info.resultCode < 0) {
        return self._error('Write failed: ' + info.resultCode);
      }

      off += info.bytesSent;
      if (off !== data.length)
        return send();

      // Write queued data
      self.writing = false;
      if (self.writeQueue.length) {
        var item = self.writeQueue.shift();
        self.write(item.data, item.enc, item.cb);
      }

      if (cb)
        cb();
    });
  }
};

exports.connect = function connect(port, host) {
  var s = new Socket();
  s.connect(port, host);
  return s;
};
