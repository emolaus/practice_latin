/*
 * harness.js - A tiny zero-dependency test harness that runs in the browser.
 * Results are written into #results and summarised in document.title as
 * "PASS x/y" or "FAIL x/y" so a headless browser run can be checked.
 */
(function (root) {
  'use strict';
  const tests = [];

  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function fmt(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

  const assert = {
    ok: function (v, msg) { if (!v) throw new Error(msg || ('Expected truthy, got ' + fmt(v))); },
    equal: function (a, b, msg) {
      if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + fmt(b) + ', got ' + fmt(a));
    },
    deepEqual: function (a, b, msg) {
      if (fmt(a) !== fmt(b)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + fmt(b) + ', got ' + fmt(a));
    },
    includes: function (hay, needle, msg) {
      if (String(hay).indexOf(needle) === -1) {
        throw new Error((msg ? msg + ': ' : '') + 'expected ' + fmt(hay) + ' to include ' + fmt(needle));
      }
    },
    throws: function (fn, re) {
      try { fn(); } catch (e) {
        if (re && !re.test(e.message)) throw new Error('Wrong error: ' + e.message);
        return;
      }
      throw new Error('Expected function to throw');
    },
    rejects: async function (promise, re) {
      try { await promise; } catch (e) {
        if (re && !re.test(e.message)) throw new Error('Wrong error: ' + e.message);
        return;
      }
      throw new Error('Expected promise to reject');
    },
  };

  async function run() {
    const out = document.getElementById('results');
    let passed = 0;
    for (const t of tests) {
      const li = document.createElement('li');
      try {
        await t.fn();
        passed++;
        li.className = 'pass';
        li.textContent = 'PASS  ' + t.name;
      } catch (e) {
        li.className = 'fail';
        li.textContent = 'FAIL  ' + t.name + ' -- ' + e.message;
      }
      out.appendChild(li);
    }
    const summary = (passed === tests.length ? 'PASS ' : 'FAIL ') + passed + '/' + tests.length;
    document.title = summary;
    const s = document.getElementById('summary');
    s.textContent = summary;
    s.className = passed === tests.length ? 'pass' : 'fail';
  }

  root.test = test;
  root.assert = assert;
  root.runTests = run;
})(window);

