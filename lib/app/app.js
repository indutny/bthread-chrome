var thread = require('./thread');
var port = chrome.runtime.connect({ name: 'bthread' });

new thread.ThreadManager(port);
