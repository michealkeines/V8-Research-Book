let x = 10;

function test() {
  eval("x = 20");
}

test();

print(x);
