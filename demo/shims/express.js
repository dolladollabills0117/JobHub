'use strict';

/**
 * A tiny in-browser stand-in for the parts of Express that server/app.js uses, so the real
 * route handlers run unchanged. Requests come from a fetch() interceptor instead of HTTP.
 */

function compile(path) {
  if (path.includes('*')) return null; // catch-all static routes are not needed in the browser
  const keys = [];
  const re = path.replace(/\/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { re: new RegExp(`^${re}$`), keys };
}

function express() {
  const layers = [];
  const add = (method, path, handlers) => {
    for (const fn of handlers) layers.push({ method, path, matcher: path ? compile(path) : null, fn });
  };
  const app = {
    disable() {},
    use(pathOrFn, ...rest) {
      if (typeof pathOrFn === 'string') add(null, pathOrFn, rest);
      else add(null, null, [pathOrFn, ...rest]);
    },
    handle(req) {
      return new Promise((resolve) => {
        const res = {
          statusCode: 200,
          headers: {},
          headersSent: false,
          status(code) { this.statusCode = code; return this; },
          setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
          json(body) { this.headersSent = true; resolve({ status: this.statusCode, headers: this.headers, body }); return this; },
          sendFile() { this.status(404).json({ error: 'Not found.' }); },
        };
        let i = 0;
        const next = (err) => {
          while (i < layers.length) {
            const layer = layers[i++];
            const isErrorHandler = layer.fn.length === 4;
            if (!!err !== isErrorHandler) continue;
            if (layer.method && layer.method !== req.method) continue;
            if (layer.path) {
              if (layer.method) {
                if (!layer.matcher) continue;
                const m = req.path.match(layer.matcher.re);
                if (!m) continue;
                req.params = Object.fromEntries(layer.matcher.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
              } else if (!(req.path === layer.path || req.path.startsWith(`${layer.path}/`))) continue;
            }
            try {
              return err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
            } catch (e) {
              return next(e);
            }
          }
          res.status(err ? 500 : 404).json({ error: err ? 'Something went wrong.' : 'Not found.' });
        };
        next();
      });
    },
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    app[m] = (path, ...handlers) => add(m.toUpperCase(), path, handlers);
  }
  return app;
}

const passthrough = () => (_req, _res, next) => next();
express.json = passthrough;
express.static = passthrough;

module.exports = express;
