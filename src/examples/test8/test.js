class A {
  constructor(x) {
    this.x = x;
  }

  getX() {
    return this.x;
  }
}

class B extends A {
  getDouble() {
    return this.x * 2;
  }
}

let b = new B(7);

print(b.getDouble());
