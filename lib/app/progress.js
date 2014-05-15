var stripe = $('#progress-stripe');

function Progress() {
  this.active = false;
  this.percent = 0;
}

Progress.prototype.tick = function tick(current, total) {
  var percent = ((current / total) * 100) | 0;

  // Ignore spurious draws
  if (percent - this.percent < 2 && percent !== 100)
    return;

  this.percent = percent;
  this.draw();
};

Progress.prototype.reset = function reset() {
  if (!this.active)
    return;

  stripe.css('width', '0%');
  stripe.css('opacity', 0);
  this.active = false;
};

Progress.prototype.activate = function activate() {
  this.active = true;
  stripe.css('opacity', 1);
};

Progress.prototype.draw = function draw() {
  if (!this.active)
    return;
  stripe.css('width', this.percent + '%');
};

var queue = [];

exports.get = function get() {
  var p = new Progress();
  queue.push(p);
  if (queue.length === 1)
    p.activate();
  return p;
};

exports.release = function release(p) {
  var index = queue.indexOf(p);
  if (index === -1)
    return;

  // Reset stripe
  p.reset();

  queue.splice(index, 1);
  if (index === 0 && queue.length > 0)
    queue[0].activate();
};
