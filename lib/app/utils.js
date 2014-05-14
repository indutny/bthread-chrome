var bn = require('bn.js');

// Copy-paste from bcoin
exports.toBTC = function toBTC(satoshi) {
  var m = new bn(10000000).mul(new bn(10));
  var lo = satoshi.mod(m);
  if (lo.cmpn(0) !== 0) {
    lo = lo.toString(10);
    while (lo.length < 8)
      lo = '0' + lo;
    lo = '.' + lo;
  } else {
    lo = '';
  }
  return satoshi.div(m).toString(10) + lo.replace(/0+$/, '');
};
