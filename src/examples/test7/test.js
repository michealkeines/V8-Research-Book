function test(n) {
  try {
    if (n < 0) {
      throw "bad";
    }

    return n;
  } catch (e) {
    return 0;
  }
}

print(test(-1));
