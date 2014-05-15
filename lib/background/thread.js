var socket = require('./socket');
var dns = require('./dns');
var bthread = require('bthread');
var level = require('level-js');
var levelup = require('levelup');
var bcoin = require('bcoin');

var addrs = [
  'seed.bitcoin.sipa.be',
  'dnsseed.bluematt.me',
  'dnsseed.bitcoin.dashjr.org',
  'seed.bitcoinstats.com',
  'seed.bitnodes.io',
  'bitseed.xf2.org'
];

// Reuse pool and db between threads
var db = levelup('bthread', {
  db: level,
  valueEncoding: 'json'
});
var pool = new bcoin.pool({
  createConnection: function() {
    return socket.connect(8333, addrs[(Math.random() * addrs.length) | 0]);
  },
  storage: db
});

exports.db = db;
exports.pool = pool;

exports.create = function create(host) {
  var thread = new bthread({
    pool: pool,
    db: db,
    host: host,

    resolveTxt: dns.resolveTxt
  });

  thread.on('log', function() {
    console.log.apply(console, arguments);
  });

  thread.on('wallet', function(addr) {
    console.log('Thread owner\'s wallet is %s', addr);
  });

  return thread;
};
