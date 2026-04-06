function makeCounter() {
  let x = 0;

  return function() {
    x++;
    return x;
  };
}

let c = makeCounter();

print(c());
print(c());
