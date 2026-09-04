// coverage_target.js — cover テスト用。used() は呼ばれ、unused() は呼ばれない想定。
export function used() {
  return 'used';
}
export function unused() {
  const x = 42;
  return x * 2;
}
