/** Leading + trailing throttle with cancel(), used for live slider updates. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;

  const run = () => {
    last = Date.now();
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };

  const throttled = (...args) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      clearTimeout(timer);
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  };
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}
