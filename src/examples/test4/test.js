function Point(x, y) {
  this.x = x;
  this.y = y;
}

Point.prototype.sum = function() {
  return this.x + this.y;
};

let p = new Point(5, 6);

print(p.sum());
