function sum(n) {
  let s = 0;

  for (let i = 0; i < n; i++) {
    s += i;
  }

  return s;
}

print(sum(5));
