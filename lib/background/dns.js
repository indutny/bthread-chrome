var dns = require('dns.js');

var client = null;
var queue = null;

exports.resolveTxt = function resolveTxt(host, cb) {
  if (client)
    return client.query('TXT', host, cb);
  if (queue) {
    queue.push(function() {
      resolveTxt(host, cb);
    });
    return;
  }

  queue = [];
  chrome.sockets.udp.create(function(info) {
    bind(info.socketId, function(err) {
      if (err)
        throw err;

      client.query('TXT', host, cb);
      var q = queue;
      queue = null;
      q.forEach(function(fn) {
        fn();
      });
    });
  });
};
function bind(socketId, cb) {
  chrome.sockets.udp.bind(socketId, '0.0.0.0', 0, function(info) {
    if (info.result < 0)
      return cb(new Error('Bind failure ' + chrome.runtime.lastError));

    client = new dns.Client({
      send: function send(data) {
        chrome.sockets.udp.send(socketId,
                                new Uint8Array(data).buffer,
                                '8.8.8.8',
                                53,
                                function() {});
      }
    });

    chrome.sockets.udp.onReceive.addListener(function(info) {
      if (info.socketId === socketId) {
        var data = new Uint8Array(info.data);
        client.feed(data);
      }
    });

    cb(null);
  });
}
