import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { subscriptionAllows } from '../src/lib/public-tracking.js';

test('subscription access denies unpaid, expired and suspended staff; grants explicit exemptions', t => {
  const python = spawnSync('python', ['--version']);
  if (python.error) return t.skip('Python SQLite is unavailable');
  const script = `import sys,json,sqlite3
sql=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript('CREATE TABLE users(id TEXT, role TEXT, subscription_exempt BOOLEAN, subscription_suspended BOOLEAN); CREATE TABLE photographer_subscriptions(id TEXT, staff_id TEXT, plan TEXT, activated_at TEXT, expires_at TEXT);')
db.executemany('INSERT INTO users VALUES(?,?,?,?)', [('unpaid','admin',0,0),('expired','admin',0,0),('paid','admin',0,0),('portfolio','admin',0,0),('free','admin',1,0),('suspended','admin',1,1),('owner','owner',0,0)])
db.executemany('INSERT INTO photographer_subscriptions VALUES(?,?,?,?,?)', [('1','expired','studio','2000-01-01','2001-01-01'),('2','paid','studio','2000-01-01','2999-01-01'),('3','portfolio','portfolio','2000-01-01','2999-01-01'),('4','suspended','studio','2000-01-01','2999-01-01'),('5','unpaid','studio',None,None)])
print(json.dumps(db.execute('SELECT u.id, '+sql[0]+', '+sql[1]+' FROM users u ORDER BY u.id').fetchall()))`;
  const result = spawnSync('python', ['-c', script], { input: JSON.stringify([subscriptionAllows('u.id'), subscriptionAllows('u.id', true)]), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    ['expired', 0, 0], ['free', 1, 1], ['owner', 1, 1], ['paid', 1, 1], ['portfolio', 1, 0], ['suspended', 0, 0], ['unpaid', 0, 0],
  ]);
});

test('dashboard middleware keeps renewal overview accessible but denies unpaid writes and Studio operations', async () => {
  const source = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const start = source.indexOf('router.use(async (req, _res, next) => {');
  const code = source.slice(start, source.indexOf('\n});', start) + 4);
  let middleware;
  let access;
  const ctx = vm.createContext({ router: { use(fn) { middleware = fn; } }, query: async () => [access], subscriptionAllows: () => 'TRUE', httpError: (status, message) => Object.assign(new Error(message), { status }) });
  vm.runInContext(code, ctx);
  const check = async (path, method, expected, grant) => {
    access = grant;
    let passed = false;
    const call = () => middleware({ user: { id: 'staff', role: 'admin' }, path, method }, {}, () => { passed = true; });
    if (expected) { await call(); assert.ok(passed); }
    else await assert.rejects(call(), error => error.status === 403);
  };
  const unpaid = { portfolio: false, studio: false };
  await check('/bootstrap', 'GET', true, unpaid);
  await check('/portfolio', 'GET', true, unpaid);
  await check('/portfolio/profile', 'PUT', false, unpaid);
  await check('/booking', 'GET', false, unpaid);
  await check('/portfolio/profile', 'PUT', true, { portfolio: true, studio: false });
  await check('/booking', 'GET', false, { portfolio: true, studio: false });
  await check('/booking', 'GET', true, { portfolio: true, studio: true });
});

test('renewal reminders choose correct phases, deduplicate sent reminders and retry failed mail', async () => {
  const source = fs.readFileSync(new URL('../src/lib/subscription-reminders.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  const sent = new Set();
  let count = 0;
  let success = false;
  const conn = { execute: async (sql, args) => {
    const key = args.join(':');
    if (sql.startsWith('INSERT')) { if (sent.has(key)) return [[]]; sent.add(key); return [[{ subscription_id: args[0] }]]; }
    if (sql.startsWith('DELETE')) sent.delete(key);
    return [[]];
  } };
  const ctx = vm.createContext({ query: async () => [{ id: 'sub', user_id: 'user', name: 'Client', email: 'example@example.com', days_left: 7 }], transaction: async fn => fn(conn), sendMail: async () => { count++; return { status: success ? 'sent' : 'failed' }; }, config: { appUrl: 'https://example.com' } });
  vm.runInContext(source, ctx);
  for (const [days, expected] of [[8, null], [7, 'week'], [2, 'week'], [1, 'day'], [0, 'expired'], [-7, 'expired'], [-8, null]]) assert.equal(vm.runInContext(`subscriptionReminderPhase(${days})`, ctx), expected);
  await vm.runInContext('sendSubscriptionReminders()', ctx);
  assert.equal(sent.size, 0);
  success = true;
  await vm.runInContext('sendSubscriptionReminders()', ctx);
  await vm.runInContext('sendSubscriptionReminders()', ctx);
  assert.equal(count, 2);
  assert.equal(sent.size, 1);
});

test('public payment form shows only owner-configured methods and recalculates annual prices', async () => {
  const source = fs.readFileSync(new URL('../../js/subscriptions.js', import.meta.url), 'utf8');
  async function setup(config) {
    const buttons = ['moncash', 'natcash'].map(key => ({ dataset: { paymentMethod: key }, hidden: true, attrs: {}, addEventListener(type, fn) { this.click = fn; }, setAttribute(key, value) { this.attrs[key] = value; } }));
    const status = {};
    const submit = { disabled: true };
    const number = {};
    const amount = {};
    const method = { value: '', options: [], add(option) { this.options.push(option); if (!this.value) this.value = option.value; } };
    const form = { elements: { plan: { value: 'portfolio' }, period: { value: 'month' }, method }, addEventListener() {}, querySelector: selector => selector === '[role=status]' ? status : submit };
    const ids = { subscription: form, 'subscription-number': number, 'subscription-amount': amount, 'subscription-copy': {} };
    const context = vm.createContext({ document: { getElementById: id => ids[id], querySelectorAll: selector => selector === '[data-payment-method]' ? buttons : [] }, fetch: async () => ({ ok: true, json: async () => config }), Option: function(text, value) { this.text = text; this.value = value; } });
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return { buttons, submit, number, amount, context };
  }
  const prices = { portfolio: { month: 500, year: 5000 }, studio: { month: 1000, year: 12000 } };
  const available = await setup({ moncash: '', natcash: '12345678', prices });
  assert.ok(available.buttons[0].hidden);
  assert.equal(available.buttons[1].hidden, false);
  assert.equal(available.number.value, '12345678');
  assert.equal(available.submit.disabled, false);
  vm.runInContext("period.value = 'year'; sync();", available.context);
  assert.equal(available.amount.textContent, '5000 GDS');
  const moncash = await setup({ moncash: '87654321', natcash: '', prices });
  assert.equal(moncash.buttons[0].hidden, false);
  assert.equal(moncash.buttons[1].hidden, true);
  assert.equal(moncash.number.value, '87654321');
  const both = await setup({ moncash: '87654321', natcash: '12345678', prices });
  assert.ok(both.buttons.every(button => !button.hidden));
  assert.equal(both.number.value, '87654321');
  both.buttons[1].click();
  assert.equal(both.number.value, '12345678');
  assert.equal(both.buttons[1].attrs['aria-pressed'], 'true');
  const unavailable = await setup({ moncash: '', natcash: '', prices });
  assert.ok(unavailable.buttons.every(button => button.hidden));
  assert.equal(unavailable.submit.disabled, true);
});
