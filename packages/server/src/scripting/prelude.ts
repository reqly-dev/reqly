import { sandboxMessages } from '../i18n/messages.js';
import {
  SCRIPT_HTTP_MAX_BODY_BYTES,
  SCRIPT_SEND_REQUEST_MAX,
  SCRIPT_TIMER_QUEUE_MAX,
  type ScriptPhase,
} from './protocol.js';

/**
 * İzole ortam içinde çalışacak `rq` API'sinin kaynak kodu.
 *
 * Tasarım notu: host'a senkron IPC round-trip yapmak yerine (TASARIM.md §5.2'deki
 * "yapılandırılmış mesaj" ilkesine uygun biçimde), tüm okuma/yazma isolate-local
 * dizilerde/nesnelerde tutulur; script çalışması bittiğinde (hata olsa bile) bu
 * durumun tamamı host tarafından `copy:true` ile tek seferde geri okunur. Host'a
 * hiçbir zaman canlı bir referans sızdırılmaz.
 *
 * Tek istisna `rq.sendRequest`: isolate'ın ağa çıkması gerektiği için worker'ın
 * `__sendRequest` adıyla verdiği tek bir `ivm.Reference` (host fonksiyonu)
 * `applySyncPromise` ile çağrılır; isteğin JSON'u gider, yanıtın JSON'u gelir.
 * Referans prelude kapanışına alınıp global'den silinir; kullanıcı script'i ona
 * doğrudan erişemez (bkz. sandbox.ts).
 *
 * Zamanlayıcılar: isolate'ta event loop / gerçek `setTimeout` yoktur. `setTimeout(fn, ms)`
 * fn'i bir kuyruğa ekler; ana gövde (ve varsa `await` zinciri) bittikten sonra kuyruk
 * kayıt sırasıyla, gecikme değeri YOK SAYILARAK çalıştırılır (bkz. sandbox.ts çalıştırma
 * sarmalayıcısı). `setInterval` desteklenmez.
 *
 * Dil: kullanıcıya görünen metinler `i18n/messages.ts`'deki `sandbox.*` alt kümesinden gelir; iki dilli
 * tablo JSON olarak gömülür, `__meta.language` (tr|en) ile `T(key, params)` seçer. pm-compat aynı
 * fonksiyonu `__t` üzerinden alır ve global'den siler; kullanıcı script'i görmez.
 */
export function buildPreludeSource(phase: ScriptPhase): string {
  const isPreRequest = phase === 'pre-request';
  return `
(function () {
  'use strict';

  globalThis.__logs = [];
  globalThis.__testResults = [];
  globalThis.__variableMutations = [];
  // sandbox.ts'nin çalıştırma sarmalayıcısı okur: ana gövde bitti mi, hata ne, zamanlayıcı kuyruğu
  globalThis.__runState = { done: false, error: undefined };

  var sendRequestRef = globalThis.__sendRequest;
  delete globalThis.__sendRequest;
  var meta = globalThis.__meta || {};
  delete globalThis.__meta;

  var MSG = ${JSON.stringify(sandboxMessages())};
  var LANG = meta.language === 'en' ? 'en' : 'tr';
  function T(key, params) {
    var s = (MSG[key] || {})[LANG] || key;
    if (!params) return s;
    return s.replace(/\\{(\\w+)\\}/g, function (m, name) { return params[name] === undefined ? m : String(params[name]); });
  }
  globalThis.__t = T;

  function pushLog(level, args) {
    var message = args.map(function (a) {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.name + ': ' + a.message;
      // JSON.stringify undefined/function/symbol için undefined döner; tarayıcı konsolu gibi String'e düş
      var s;
      try { s = JSON.stringify(a); } catch (e) { /* döngüsel vb. */ }
      return s === undefined ? String(a) : s;
    }).join(' ');
    globalThis.__logs.push({ level: level, message: message });
  }
  globalThis.console = {
    log: function () { pushLog('log', Array.prototype.slice.call(arguments)); },
    warn: function () { pushLog('warn', Array.prototype.slice.call(arguments)); },
    error: function () { pushLog('error', Array.prototype.slice.call(arguments)); },
  };

  // Tarayıcı/Postman sandbox'ındaki Base64 yardımcıları (Basic auth başlığı üretmek için yaygın).
  // isolate'ta Node/tarayıcı globali yoktur; saf JS, Latin1 sınırı tarayıcıyla aynı (InvalidCharacterError).
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function invalidChar(fn) {
    var e = new Error("Failed to execute '" + fn + "': The string to be encoded contains characters outside of the Latin1 range.");
    e.name = 'InvalidCharacterError';
    return e;
  }
  globalThis.btoa = function btoa(input) {
    var str = String(input);
    var out = '';
    for (var i = 0; i < str.length; i += 3) {
      var c1 = str.charCodeAt(i), c2 = str.charCodeAt(i + 1), c3 = str.charCodeAt(i + 2);
      if (c1 > 255 || c2 > 255 || c3 > 255) throw invalidChar('btoa');
      var n = (c1 << 16) | ((c2 || 0) << 8) | (c3 || 0);
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
        (i + 1 < str.length ? B64.charAt((n >> 6) & 63) : '=') +
        (i + 2 < str.length ? B64.charAt(n & 63) : '=');
    }
    return out;
  };
  globalThis.atob = function atob(input) {
    var str = String(input).replace(/[\\t\\n\\f\\r ]/g, '');
    if (str.length % 4 === 0) str = str.replace(/==?$/, '');
    if (str.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(str)) {
      var e = new Error("Failed to execute 'atob': The string to be decoded is not correctly encoded.");
      e.name = 'InvalidCharacterError';
      throw e;
    }
    var out = '', bits = 0, acc = 0;
    for (var i = 0; i < str.length; i++) {
      acc = (acc << 6) | B64.indexOf(str.charAt(i));
      bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
    }
    return out;
  };

  function scopeStore(scope) {
    return globalThis.__variables[scope] || (globalThis.__variables[scope] = {});
  }
  function makeScopeApi(scope) {
    return {
      get: function (key) {
        var entry = scopeStore(scope)[key];
        return entry ? entry.value : undefined;
      },
      set: function (key, value) {
        scopeStore(scope)[key] = { value: String(value), isSecret: false };
        globalThis.__variableMutations.push({ scope: scope, key: key, action: 'set', value: String(value) });
      },
      unset: function (key) {
        delete scopeStore(scope)[key];
        globalThis.__variableMutations.push({ scope: scope, key: key, action: 'unset' });
      },
    };
  }

  var rq = {};
  rq.environment = makeScopeApi('environment');
  rq.environment.name = meta.environmentName; // seçili ortam yoksa undefined (Postman ile aynı)
  rq.collectionVariables = makeScopeApi('collection');
  rq.globals = makeScopeApi('global');
  rq.variables = {
    get: function (key) {
      var v = rq.environment.get(key);
      if (v !== undefined) return v;
      v = rq.collectionVariables.get(key);
      if (v !== undefined) return v;
      return rq.globals.get(key);
    },
    // {{var}} ifadelerini o anki (script'in kendi set'leri dahil) değişken durumuna göre çözer;
    // çözülemeyen ifade olduğu gibi kalır (engine/interpolate.ts ile aynı desen ve öncelik)
    replaceIn: function (input) {
      return String(input).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function (match, key) {
        var v = rq.variables.get(key);
        return v === undefined ? match : v;
      });
    },
  };

  // ---- Zamanlayıcı kuyruğu (gerçek zamanlayıcı yok; dosya başındaki nota bakın) ----
  var timerQueue = [];
  var timerSeq = 0;
  globalThis.__drainTimers = async function () {
    while (timerQueue.length > 0) {
      var t = timerQueue.shift();
      await t.fn.apply(undefined, t.args);
    }
  };
  globalThis.setTimeout = function (fn) {
    if (typeof fn !== 'function') throw new TypeError(T('setTimeoutNotFunction'));
    if (timerQueue.length >= ${SCRIPT_TIMER_QUEUE_MAX}) {
      throw new Error(T('setTimeoutQueueFull', { max: ${SCRIPT_TIMER_QUEUE_MAX} }));
    }
    var id = ++timerSeq;
    timerQueue.push({ id: id, fn: fn, args: Array.prototype.slice.call(arguments, 2) });
    return id;
  };
  globalThis.clearTimeout = function (id) {
    timerQueue = timerQueue.filter(function (t) { return t.id !== id; });
  };
  globalThis.setInterval = function () {
    throw new Error(T('setIntervalUnsupported'));
  };
  globalThis.clearInterval = function () {};

  // ---- rq.sendRequest: script içinden HTTP isteği (host üzerinden; isolate ağa çıkmaz) ----
  var REASON = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently',
    302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity',
    429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
    504: 'Gateway Timeout' };
  var sendRequestCount = 0;

  function headerList(input) {
    // Postman: 'header' ya da 'headers'; nesne ({ 'X': 'y' }) ya da dizi ([{ key, value, enabled? }])
    var out = [];
    if (!input) return out;
    if (Array.isArray(input)) {
      input.forEach(function (h) {
        if (!h || h.enabled === false || h.disabled === true) return;
        if (typeof h.key !== 'string') throw new TypeError(T('headerItemShape'));
        out.push([rq.variables.replaceIn(h.key), rq.variables.replaceIn(h.value == null ? '' : h.value)]);
      });
      return out;
    }
    if (typeof input === 'object') {
      Object.keys(input).forEach(function (k) {
        out.push([rq.variables.replaceIn(k), rq.variables.replaceIn(input[k] == null ? '' : input[k])]);
      });
      return out;
    }
    throw new TypeError(T('headerShape'));
  }
  function hasHeader(headers, name) {
    return headers.some(function (h) { return h[0].toLowerCase() === name; });
  }
  function encodeForm(items) {
    return (items || []).filter(function (i) { return i && i.enabled !== false && i.disabled !== true; })
      .map(function (i) {
        return encodeURIComponent(rq.variables.replaceIn(i.key)) + '=' + encodeURIComponent(rq.variables.replaceIn(i.value == null ? '' : i.value));
      }).join('&');
  }
  function normalizeRequest(req) {
    if (typeof req === 'string') req = { url: req };
    // pm.request de verilebilir: url bir { toString } nesnesi, headers bir { toObject } nesnesidir
    var rawUrl = req && typeof req === 'object' ? req.url : undefined;
    if (rawUrl && typeof rawUrl === 'object' && typeof rawUrl.toString === 'function') rawUrl = rawUrl.toString();
    if (typeof rawUrl !== 'string') {
      throw new TypeError(T('requestShape'));
    }
    var url = rq.variables.replaceIn(rawUrl).trim();
    if (!/^https?:\\/\\//i.test(url)) throw new Error(T('urlScheme', { url: url }));
    var method = req.method ? String(req.method).toUpperCase() : 'GET';
    var rawHeaders = req.header !== undefined ? req.header : req.headers;
    if (rawHeaders && typeof rawHeaders.toObject === 'function') rawHeaders = rawHeaders.toObject();
    var headers = headerList(rawHeaders);
    var body = null;
    var b = req.body;
    if (typeof b === 'string') {
      body = rq.variables.replaceIn(b);
    } else if (b && typeof b === 'object') {
      if (b.mode === 'raw') {
        body = rq.variables.replaceIn(typeof b.raw === 'string' ? b.raw : JSON.stringify(b.raw == null ? '' : b.raw));
        if (b.contentType && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', b.contentType]);
      } else if (b.mode === 'urlencoded') {
        body = encodeForm(b.urlencoded || b.items);
        if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      } else if (b.mode === 'none' || b.mode === undefined) {
        body = null;
      } else {
        throw new Error(T('bodyModeUnsupported', { mode: b.mode }));
      }
    } else if (b != null) {
      throw new TypeError(T('bodyShape'));
    }
    if (method === 'GET' || method === 'HEAD') body = null;
    return { url: url, method: method, headers: headers, body: body };
  }
  function makeResponse(r) {
    var headers = r.headers;
    function find(name) {
      var n = String(name).toLowerCase();
      return headers.find(function (h) { return h[0].toLowerCase() === n; });
    }
    if (r.truncated) {
      pushLog('warn', [T('bodyTruncated', { mb: ${SCRIPT_HTTP_MAX_BODY_BYTES} / 1048576 })]);
    }
    return {
      code: r.status,
      status: REASON[r.status] || String(r.status),
      responseTime: r.durationMs,
      body: r.body,
      truncated: r.truncated === true,
      headers: {
        get: function (name) { var f = find(name); return f ? f[1] : undefined; },
        has: function (name) { return find(name) !== undefined; },
        all: function () { return headers.map(function (h) { return { key: h[0], value: h[1] }; }); },
      },
      text: function () { return r.body; },
      json: function () {
        if (r.truncated) throw new Error(T('jsonTruncated'));
        return JSON.parse(r.body);
      },
    };
  }
  rq.sendRequest = function (req, callback) {
    if (callback !== undefined && typeof callback !== 'function') {
      throw new TypeError(T('callbackShape'));
    }
    if (!sendRequestRef) throw new Error(T('noBridge'));
    var normalized = normalizeRequest(req);
    if (++sendRequestCount > ${SCRIPT_SEND_REQUEST_MAX}) {
      throw new Error(T('sendRequestLimit', { max: ${SCRIPT_SEND_REQUEST_MAX}, n: sendRequestCount }));
    }
    var err = null, res;
    try {
      // Isolate bu noktada host yanitini bekler (senkron); worker'in event loop'u serbesttir.
      var raw = sendRequestRef.applySyncPromise(undefined, [JSON.stringify(normalized)]);
      res = makeResponse(JSON.parse(raw));
    } catch (e) {
      err = new Error(e && e.message ? e.message : String(e));
    }
    var promise = err ? Promise.reject(err) : Promise.resolve(res);
    if (callback) {
      promise.catch(function () {}); // callback'li kullanimda reddedilme callback'e gider, "unhandled" sayilmasin
      // Script err'i kontrol etmeden res.json() derse "Cannot read properties of undefined" kalir; asil
      // neden (proxy, TLS, DNS...) kaybolmasin diye Console'a uyari dusulur (kullanici geri bildirimi, 2026-11-14)
      if (err) pushLog('warn', [T('sendRequestFailed', { url: normalized.url, message: err.message })]);
      callback(err, res);
    }
    return promise;
  };

  rq.info = {
    eventName: ${isPreRequest ? "'prerequest'" : "'test'"},
    requestName: meta.requestName || '',
    requestId: meta.requestId,
    iteration: 0,
    iterationCount: 1,
  };
  rq.environmentName = meta.environmentName;

  rq.test = function (name, fn) {
    try {
      fn();
      globalThis.__testResults.push({ name: name, passed: true });
    } catch (err) {
      globalThis.__testResults.push({ name: name, passed: false, error: (err && err.message) ? err.message : String(err) });
    }
  };

  function isEqualDeep(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a === 'object') {
      var ak = Object.keys(a), bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      return ak.every(function (k) { return isEqualDeep(a[k], b[k]); });
    }
    return false;
  }

  function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }
  function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

  function makeExpectation(actual, negate) {
    function assert(cond, message) {
      var ok = negate ? !cond : cond;
      if (!ok) throw new Error((negate ? '(not) ' : '') + message);
    }
    function typeCheck(expected) {
      var t = typeName(actual);
      assert(t === String(expected).toLowerCase(), T('expectType', { expected: expected, actual: t, value: show(actual) }));
      return self;
    }
    function lengthCheck(n) {
      var len = actual != null && actual.length !== undefined ? actual.length : undefined;
      assert(len === n, T('expectLength', { expected: n, actual: len }));
      return self;
    }
    var self = {
      get not() { return makeExpectation(actual, !negate); },
      get to() { return self; },
      get be() { return self; },
      get been() { return self; },
      get is() { return self; },
      get have() { return self; },
      get has() { return self; },
      get at() { return self; },
      get that() { return self; },
      get which() { return self; },
      get and() { return self; },
      get exist() {
        assert(actual !== undefined && actual !== null, T('expectExist', { actual: actual }));
        return self;
      },
      get exists() { return self.exist; },
      get true() { assert(actual === true, T('expectValue', { expected: 'true', actual: show(actual) })); return self; },
      get false() { assert(actual === false, T('expectValue', { expected: 'false', actual: show(actual) })); return self; },
      get null() { assert(actual === null, T('expectValue', { expected: 'null', actual: show(actual) })); return self; },
      get undefined() { assert(actual === undefined, T('expectValue', { expected: 'undefined', actual: show(actual) })); return self; },
      get ok() { assert(!!actual, T('expectTruthy', { actual: show(actual) })); return self; },
      get empty() {
        var len = typeof actual === 'string' || Array.isArray(actual) ? actual.length
          : (actual && typeof actual === 'object') ? Object.keys(actual).length : undefined;
        assert(len === 0, T('expectEmpty', { actual: show(actual) }));
        return self;
      },
      a: typeCheck,
      an: typeCheck,
      length: lengthCheck,
      lengthOf: lengthCheck,
      oneOf: function (list) {
        if (!Array.isArray(list)) throw new TypeError(T('expectOneOfArray'));
        assert(list.indexOf(actual) !== -1, T('expectOneOf', { list: show(list), actual: show(actual) }));
        return self;
      },
      match: function (re) {
        assert(re instanceof RegExp && re.test(String(actual)), T('expectMatch', { pattern: String(re), actual: show(actual) }));
        return self;
      },
      least: function (n) { assert(actual >= n, T('expectLeast', { expected: n, actual: actual })); return self; },
      most: function (n) { assert(actual <= n, T('expectMost', { expected: n, actual: actual })); return self; },
      within: function (lo, hi) { assert(actual >= lo && actual <= hi, T('expectWithin', { lo: lo, hi: hi, actual: actual })); return self; },
      equal: function (expected) {
        assert(actual === expected, T('expectValue', { expected: expected, actual: actual }));
        return self;
      },
      eql: function (expected) {
        assert(isEqualDeep(actual, expected), T('expectDeepEqual', { expected: JSON.stringify(expected), actual: JSON.stringify(actual) }));
        return self;
      },
      include: function (expected) {
        var has = (typeof actual === 'string' || Array.isArray(actual))
          ? actual.indexOf(expected) !== -1
          : (actual && Object.prototype.hasOwnProperty.call(actual, expected));
        assert(has, T('expectInclude', { actual: JSON.stringify(actual), expected: JSON.stringify(expected) }));
        return self;
      },
      property: function (name) {
        assert(actual && Object.prototype.hasOwnProperty.call(actual, name), T('expectProperty', { name: name }));
        return self;
      },
      above: function (n) { assert(actual > n, T('expectAbove', { expected: n, actual: actual })); return self; },
      below: function (n) { assert(actual < n, T('expectBelow', { expected: n, actual: actual })); return self; },
    };
    self.greaterThan = self.above;
    self.lessThan = self.below;
    self.gte = self.least;
    self.lte = self.most;
    self.equals = self.equal;
    self.eq = self.equal;
    Object.defineProperty(self, 'deep', {
      get: function () {
        var d = makeExpectation(actual, negate);
        d.equal = d.equals = d.eq = d.eql;
        return d;
      },
    });
    self.includes = self.include;
    self.contain = self.include;
    self.contains = self.include;
    return self;
  }
  rq.expect = function (actual) { return makeExpectation(actual, false); };

  rq.request = globalThis.__request;
  ${
    isPreRequest
      ? ''
      : `
  try { Object.freeze(globalThis.__request); } catch (e) {}
  var __resp = globalThis.__response;
  rq.response = {
    status: __resp.status,
    statusText: __resp.status == null ? '' : String(__resp.status),
    headers: __resp.headers,
    body: __resp.body,
    durationMs: __resp.durationMs,
    json: function () { return JSON.parse(this.body); },
    text: function () { return this.body; },
    getHeader: function (name) {
      var found = this.headers.find(function (h) { return h[0].toLowerCase() === String(name).toLowerCase(); });
      return found ? found[1] : undefined;
    },
  };
  `
  }

  globalThis.rq = rq;
})();
`;
}
