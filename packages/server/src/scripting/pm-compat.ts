import type { ScriptPhase } from './protocol.js';

/**
 * Postman scriptleriyle uyumluluk katmanı (TASARIM.md §6.3).
 * Çeviri değil, `rq.*`'ya delege eden ince bir alias: desteklenen alt küme çalışır,
 * desteklenmeyen herhangi bir `pm.*` / `pm.x.*` erişimi sessizce yanlış davranmak yerine
 * çalışma zamanında açık bir hata fırlatır. Tanıtıcı erişimler (Symbol'ler, `then`,
 * `toJSON`, `inspect`) undefined döner ki `JSON.stringify(pm.environment)` ya da
 * `await pm.x` gibi ifadeler patlamasın.
 */
export function buildPmCompatSource(phase: ScriptPhase): string {
  const isPreRequest = phase === 'pre-request';
  return `
(function () {
  'use strict';
  var rq = globalThis.rq;
  // Prelude'un iki dilli mesaj seçicisi (__meta.language); kullanıcı script'i görmesin diye silinir
  var T = globalThis.__t;
  delete globalThis.__t;

  // Tanıtıcı/protokol erişimleri: bunlara undefined dönmek dil/çalışma zamanı sözleşmesidir, "desteklenmiyor" değil
  var PROBE_PROPS = { then: 1, toJSON: 1, inspect: 1, asymmetricMatch: 1, nodeType: 1, $$typeof: 1 };

  function strict(path, target) {
    return new Proxy(target, {
      get: function (t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop in t) return t[prop];
        if (PROBE_PROPS[prop]) return undefined;
        throw new Error(T('pmUnsupported', { path: path + '.' + prop }));
      },
    });
  }

  function scopeAlias(name, api, extra) {
    var obj = {
      get: function (k) { return api.get(k); },
      set: function (k, v) { return api.set(k, v); },
      unset: function (k) { return api.unset(k); },
      has: function (k) { return api.get(k) !== undefined; },
      toObject: function () {
        var store = globalThis.__variables[name] || {};
        var out = {};
        Object.keys(store).forEach(function (k) { out[k] = store[k].value; });
        return out;
      },
    };
    if (extra) Object.keys(extra).forEach(function (k) { obj[k] = extra[k]; });
    return strict('pm.' + name, obj);
  }

  function headerIndex(name) {
    var n = String(name).toLowerCase();
    return rq.request.headers.findIndex(function (h) { return h.key.toLowerCase() === n; });
  }
  ${
    isPreRequest
      ? 'function assertMutable() {}'
      : `function assertMutable(op) {
    throw new Error(T('pmHeadersReadOnly', { op: op }));
  }`
  }
  var requestHeaders = strict('pm.request.headers', {
    get: function (name) {
      var i = headerIndex(name);
      return i === -1 ? undefined : rq.request.headers[i].value;
    },
    has: function (name) { return headerIndex(name) !== -1; },
    add: function (h) {
      assertMutable('add');
      rq.request.headers.push({ key: h.key, value: h.value == null ? '' : String(h.value), enabled: true });
    },
    upsert: function (h) {
      assertMutable('upsert');
      if (!h || typeof h.key !== 'string') throw new TypeError(T('pmUpsertShape'));
      var i = headerIndex(h.key);
      var value = h.value == null ? '' : String(h.value);
      if (i === -1) rq.request.headers.push({ key: h.key, value: value, enabled: true });
      else { rq.request.headers[i].value = value; rq.request.headers[i].enabled = true; }
    },
    remove: function (name) {
      assertMutable('remove');
      var n = String(name).toLowerCase();
      var kept = rq.request.headers.filter(function (h) { return h.key.toLowerCase() !== n; });
      rq.request.headers.splice.apply(rq.request.headers, [0, rq.request.headers.length].concat(kept));
    },
    toObject: function () {
      var out = {};
      rq.request.headers.forEach(function (h) { if (h.enabled !== false) out[h.key] = h.value; });
      return out;
    },
  });

  var pmImpl = {
    environment: scopeAlias('environment', rq.environment, { name: rq.environmentName }),
    collectionVariables: scopeAlias('collectionVariables', rq.collectionVariables),
    globals: scopeAlias('globals', rq.globals),
    variables: strict('pm.variables', {
      get: function (k) { return rq.variables.get(k); },
      has: function (k) { return rq.variables.get(k) !== undefined; },
      replaceIn: function (s) { return rq.variables.replaceIn(s); },
    }),
    info: strict('pm.info', {
      eventName: rq.info.eventName,
      requestName: rq.info.requestName,
      requestId: rq.info.requestId,
      iteration: rq.info.iteration,
      iterationCount: rq.info.iterationCount,
    }),
    request: strict('pm.request', {
      headers: requestHeaders,
      url: strict('pm.request.url', { toString: function () { return rq.request.url; } }),
      get method() { return rq.request.method; },
      get body() { return rq.request.body; },
    }),
    test: function (name, fn) { return rq.test(name, fn); },
    expect: function (v) { return rq.expect(v); },
    sendRequest: function (req, cb) { return rq.sendRequest(req, cb); },
  };

  ${
    isPreRequest
      ? ''
      : `
  function responseTo(negate) {
    function check(cond, message) {
      if (negate ? cond : !cond) throw new Error((negate ? '(not) ' : '') + message);
    }
    var to = {
      have: strict('pm.response.to.have', {
        status: function (expected) {
          if (typeof expected === 'number') {
            check(rq.response.status === expected, T('pmStatusCode', { expected: expected, actual: rq.response.status }));
          } else {
            check(rq.response.statusText === String(expected), T('pmStatusText', { expected: expected, actual: rq.response.statusText }));
          }
        },
        header: function (name, value) {
          var actual = rq.response.getHeader(name);
          if (value === undefined) check(actual !== undefined, T('pmHeaderPresent', { name: name }));
          else check(actual === value, T('pmHeaderEquals', { name: name, expected: value, actual: actual }));
        },
        body: function (expected) {
          if (expected === undefined) check(rq.response.body !== '', T('pmBodyNonEmpty'));
          else if (expected instanceof RegExp) check(expected.test(rq.response.body), T('pmBodyMatch', { pattern: String(expected) }));
          else check(rq.response.body === String(expected), T('pmBodyEquals', { expected: expected }));
        },
        jsonBody: function () {
          var parsed;
          try { parsed = rq.response.json(); } catch (e) { parsed = undefined; }
          check(parsed !== undefined, T('pmJsonBody'));
        },
      }),
      be: strict('pm.response.to.be', {
        get ok() { var s = rq.response.status; check(s != null && s >= 200 && s < 300, T('pmStatusRange', { range: '2xx', actual: s })); return true; },
        get success() { return this.ok; },
        get redirection() { var s = rq.response.status; check(s != null && s >= 300 && s < 400, T('pmStatusRange', { range: '3xx', actual: s })); return true; },
        get clientError() { var s = rq.response.status; check(s != null && s >= 400 && s < 500, T('pmStatusRange', { range: '4xx', actual: s })); return true; },
        get serverError() { var s = rq.response.status; check(s != null && s >= 500 && s < 600, T('pmStatusRange', { range: '5xx', actual: s })); return true; },
        get error() { var s = rq.response.status; check(s != null && s >= 400, T('pmStatusRange', { range: '4xx/5xx', actual: s })); return true; },
      }),
    };
    if (!negate) to.not = responseTo(true);
    return strict('pm.response.to', to);
  }
  pmImpl.response = strict('pm.response', {
    json: function () { return rq.response.json(); },
    text: function () { return rq.response.text(); },
    code: rq.response.status,
    status: rq.response.statusText,
    responseTime: rq.response.durationMs,
    responseSize: rq.response.body.length,
    headers: strict('pm.response.headers', {
      get: function (name) { return rq.response.getHeader(name); },
      has: function (name) { return rq.response.getHeader(name) !== undefined; },
    }),
    to: responseTo(false),
  });
  `
  }

  globalThis.pm = strict('pm', pmImpl);
})();
`;
}
