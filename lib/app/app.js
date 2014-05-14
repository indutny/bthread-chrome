var thread = require('./thread');
var port = chrome.runtime.connect({ name: 'bthread' });

var modal = {
  passphrase: $('#modal-passphrase')
};

// Ask passphrase
modal.passphrase.modal({
  keyboard: false,
  backdrop: 'static'
});
modal.passphrase.find('form').submit(function(e) {
  e.preventDefault();

  port.postMessage({
    type: 'passphrase',
    passphrase: modal.passphrase.find('input').val()
  });
  modal.passphrase.modal('hide');

  start();
});

function start() {
  new thread.ThreadManager(port);
}
