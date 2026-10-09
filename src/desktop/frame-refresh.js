/** Every caller waits for the in-flight read and any newer frame requested while that read was pending. */
export function createFrameRefresher(load) {
  let pending = null, requested = false;
  return function refresh() {
    requested = true;
    if (!pending) pending = Promise.resolve().then(async () => {
      while (requested) { requested = false; await load(); }
    }).then(() => {
      pending = null;
      if (requested) return refresh();
    }, error => { pending = null; throw error; });
    return pending;
  };
}
