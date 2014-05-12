var dns = require('dns.js');

var client = null;

exports.resolveTxt = function resolveTxt(host, cb) {
  if (client)
    return client.query('TXT', host, cb);

  chrome.sockets.udp.create(function(info) {
    bind(info.socketId, function(err) {
      if (err)
        throw err;

      client.query('TXT', host, cb);
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
      if (info.socketId === socketId)
        client.feed(new Uint8Array(info.data));
    });

    cb(null);
  });
}
