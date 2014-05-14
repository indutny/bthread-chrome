var dns = require('dns.js');

var client = null;
var queue = null;

function query(host, cb, retries) {
  if (!retries)
    retries = 0;
  if (retries >= 4)
    return cb(new Error('ETIMEDOUT'));

  client.query('TXT', host, function(err, ans) {
    if (err)
      return query(host, cb, retries + 1);

    cb(null, ans);
  });
}

exports.resolveTxt = function resolveTxt(host, cb) {
  if (client)
    return query(host, cb);
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

      query(host, cb);
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
    client.timeout = 15000;

    chrome.sockets.udp.onReceive.addListener(function(info) {
      if (info.socketId === socketId) {
        var data = new Uint8Array(info.data);
        client.feed(data);
      }
    });

    cb(null);
  });
}
