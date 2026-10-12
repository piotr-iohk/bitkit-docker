const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
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
    assert(callsAfter.estimatesWithOverride > callsBefore.estimatesWithOverride);
    assert(callsAfter.paymasterAuthorizations > callsBefore.paymasterAuthorizations);
    assert.equal(callsAfter.submissions, callsBefore.submissions);
    assert(quote.amount > 0 && quote.maximum_fee > 0);
    assert(BigInt(quote.amount) + BigInt(quote.maximum_fee) <= before);
    assert.equal(BigInt(await rpc(urls.control, 'balance', [sender])), before);
    assert.equal(BigInt(await rpc(urls.control, 'balance', [recipient])), 0n);
    assert.equal(BigInt(await rpc(urls.node, 'eth_getBalance', [sender, 'latest'])), 0n);
    assert.equal(await rpc(urls.node, 'eth_getCode', [sender, 'latest']), '0x');
    console.log(
      JSON.stringify({ passed: true, balance: before.toString(), quote, submitted: false }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { smoke };
