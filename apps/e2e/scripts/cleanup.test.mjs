import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupAll } from '../tests/cleanup.ts';

test('cleanup drains in reverse order and is safe to repeat', async () => {
  const order = [];
  const actions = [async () => { order.push('database'); }, () => { order.push('server'); }];
  await cleanupAll(actions);
  await cleanupAll(actions);
  assert.deepEqual(order, ['server', 'database']);
  assert.equal(actions.length, 0);
});

test('sole teardown failures are aggregated after every resource is attempted', async () => {
  const first = new Error('browser close');
  const second = new Error('database disconnect');
  const order = [];
  const actions = [
    () => { order.push('database'); throw second; },
    async () => { order.push('server'); },
    async () => { order.push('browser'); throw first; },
  ];
  await assert.rejects(cleanupAll(actions), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.deepEqual(order, ['browser', 'server', 'database']);
  assert.equal(actions.length, 0);
});

test('reports teardown errors without replacing an existing failure', async () => {
  const primary = new Error('original assertion failed');
  const teardown = new Error('MongoDB stop');
  const reports = [];
  const scenario = async () => {
    try { throw primary; }
    finally { await cleanupAll([() => { throw teardown; }], { error: primary }, error => reports.push(error)); }
  };
  await assert.rejects(scenario(), error => error === primary);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].errors, [teardown]);
  assert.equal(reports[0].cause, primary);
});

test('an existing failure needs no cleanup report when all resources close', async () => {
  const reports = [];
  await cleanupAll([async () => {}], { error: new Error('primary') }, error => reports.push(error));
  assert.deepEqual(reports, []);
});
