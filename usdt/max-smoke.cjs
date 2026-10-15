const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { rpc } = require('./rpc.cjs');
const { state, urls } = require('./config.cjs');
const exec = promisify(execFile);

async function smoke() {
  const directory = mkdtempSync(path.join(state, 'max-smoke-'));
  const runId = randomUUID();
  const wallet = async (name, ...args) => {
    const { stdout } = await exec('usdt-fixture-wallet', args, {
      env: {
        ...process.env,
        USDT_WALLET_DIR: directory,
        USDT_WALLET_NAME: `${runId}-${name}`,
      },
      timeout: 120000,
    });
    return JSON.parse(stdout);
  };
  try {
    assert.equal((await rpc(urls.control, 'status')).mode, 'healthy');
    const sender = (await wallet('sender', 'address')).address;
    const recipient = (await wallet('recipient', 'address')).address;
    await rpc(urls.control, 'fund', [sender, '20']);
    const before = BigInt(await rpc(urls.control, 'balance', [sender]));
    const callsBefore = (await rpc(urls.control, 'status')).max;
    const quote = await wallet('sender', 'quote-max', recipient);
    const callsAfter = (await rpc(urls.control, 'status')).max;
    const calls = Object.fromEntries(
      Object.keys(callsAfter).map((key) => [key, callsAfter[key] - callsBefore[key]]),
    );
    // Core's MAX quote takes at most three fee rounds, each one override estimate and one
    // paymaster authorization; the counters are the provider's, so nothing else may quote meanwhile.
    assert(
      calls.estimatesWithOverride >= 1 && calls.estimatesWithOverride <= 3,
      JSON.stringify(calls),
    );
    assert(
      calls.paymasterAuthorizations >= 1 && calls.paymasterAuthorizations <= 3,
      JSON.stringify(calls),
    );
    assert.equal(calls.submissions, 0, JSON.stringify(calls));
    assert(quote.amount > 0 && quote.maximum_fee > 0);
    // MAX quotes the whole balance: the amount is the balance less the fee reserve.
    assert.equal(BigInt(quote.amount) + BigInt(quote.maximum_fee), before);
    assert.equal(BigInt(await rpc(urls.control, 'balance', [sender])), before);
    assert.equal(BigInt(await rpc(urls.control, 'balance', [recipient])), 0n);
    assert.equal(BigInt(await rpc(urls.node, 'eth_getBalance', [sender, 'latest'])), 0n);
    assert.equal(await rpc(urls.node, 'eth_getCode', [sender, 'latest']), '0x');
    const sent = await wallet('sender', 'send-quote', quote.id);
    let payment = sent;
    for (let attempt = 0; attempt < 40 && payment.status === 'Pending'; attempt++) {
      await delay(500);
      payment = await wallet('sender', 'refresh', sent.id);
    }
    assert.equal(payment.status, 'Confirmed');
    assert.equal(payment.amount, quote.amount);
    assert(payment.fee > 0 && payment.fee <= quote.maximum_fee);
    assert.equal(BigInt(await rpc(urls.control, 'balance', [recipient])), BigInt(quote.amount));
    assert.equal(
      BigInt(await rpc(urls.control, 'balance', [sender])),
      before - BigInt(quote.amount) - BigInt(payment.fee),
    );
    assert.equal(BigInt(await rpc(urls.node, 'eth_getBalance', [sender, 'latest'])), 0n);
    console.log(
      JSON.stringify({ passed: true, balance: before.toString(), quote, calls, payment }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { smoke };
