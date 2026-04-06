function sum(arr) {
  let s = 0;

  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
  }

  return s;
}

print(sum([1,2,3,4]));
