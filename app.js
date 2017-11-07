'use strict';

const XrpEscrowPlugin = require('ilp-plugin-xrp-escrow');
const IlpPacket = require('ilp-packet')
const crypto = require('crypto');
const express = require('express');

function sha256(preimage) {
  return crypto.createHash('sha256').update(preimage).digest()
}

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64url_decode(string) {
  return new Buffer(
    string.replace(/\-/g, '+').replace(/\_/g, '/'), 'base64');
}

const plugins = [];

registerPlugin(new XrpEscrowPlugin({
    secret: 'sndb5JDdyWiHZia9zv44zSr2itRy1',
    account: 'rGtqDAJNTDMLaNNfq1RVYgPT8onFMj19Aj',
    server: 'wss://s.altnet.rippletest.net:51233',
    prefix: 'test.crypto.xrp.',
  }), 0.2);

plugins.push({
    ledgerPrefix: 'test.stripe.usd.',
    account: 'test.stripe.usd.merchant-1234',
    currencyCode: 'USD',
    currencyScale: 2,
    exchangeRate: 1,
  });

/**
 * Register a plugin with the server including the rate of exchange to use.
 * 
 * Will connect the plugin and get info about the ledger and account
 * 
 * @param {*} plugin An LPI plugin configured for a receiving account
 * @param {*} exchangeRate The exchange rates this receiving account uses vs the
 */
function registerPlugin(plugin, exchangeRate) {
  plugin.connect().then(() => {
    const ledgerInfo = plugin.getInfo();
    const account = plugin.getAccount();

    console.log(`Connected to ledger: ${ledgerInfo.prefix}`);
    console.log(` - Account: ${account}`);
    console.log(` - Currency: ${ledgerInfo.currencyCode}`);
    console.log(` - CurrencyScale: ${ledgerInfo.currencyScale}`);
    console.log(` - ExchangeRate: ${exchangeRate}`);

    registerPaymentHandler(plugin);

    plugins.push({
      ledgerPrefix: ledgerInfo.prefix,
      account: account,
      currencyCode: ledgerInfo.currencyCode,
      currencyScale: ledgerInfo.currencyScale,
      exchangeRate: exchangeRate,
//      secret: crypto.randomBytes(32),
      plugin: plugin,
    });
  });
}

function registerPaymentHandler(plugin) {
  plugin.on('incoming_prepare', function(transfer) {
      const condition = transfer.executionCondition;
      const transferId = transfer.id;
      const ilpPacket = base64url_decode(transfer.ilp);
      const fulfillment = sha256(ilpPacket);
      const testCondition = base64url(sha256(fulfillment));

      console.log(`Incoming payment for tx: ${transferId}`);

      if(condition !== testCondition) {
        console.log(` - Unfulfillable condition: ${condition}`);
        plugin.rejectIncomingTransfer(transferId, {
          code: 'F05',
          name: 'Wrong Condition',
          message: `Unable to fulfill the condition:` +
                    ` ${base64url(condition)}`,
          triggered_by: plugin.getAccount(),
          triggered_at: new Date().toISOString(),
          forwarded_by: [],
          additional_info: {},
        });
      } else {
        // The ledger will check if the fulfillment is correct and
        // if it was submitted before the transfer's rollback timeout
        plugin.fulfillCondition(transferId, fulfillment).then(() => {
          console.log(`Payment complete (fulfilled)`);
        }).catch(() => {
          console.log(`Error fulfilling the transfer`);
        });
      }
  });
}

const app = express();

app.get('/demo/ilp-addresses.json', (req, res) => {
  let pluginData = [];
  plugins.forEach(function(plugin) {
    pluginData.push({
      address: plugin.account,
      currencyCode: plugin.currencyCode,
      currencyScale: plugin.currencyScale,
      exchangeRate: plugin.exchangeRate,
    });
  });
  res.json(pluginData);
});

/**
 * Construct payment request data for this receiving address
 */
app.post('/demo/create-payment-request/', express.json(), (req, res) => {

  const address = req.body.address;
  const amount = req.body.amount;

  // Find receiving account
  const plugin = plugins.find(
    (p) => address.startsWith(p.account));

  if(!plugin) {
    res.status(400).send({
      error: 'Unknown address.',
    });
  } else {
    const convertedAmount = amount / plugin.exchangeRate;
    const ledgerAmount = convertedAmount * Math.pow(10, plugin.currencyScale);

    const packet = IlpPacket.serializeIlpPayment({
      amount: `${ledgerAmount}`,
      account: address,
    });

    const fulfillment = sha256(packet);
    const condition = sha256(fulfillment);

    res.json({
      address: address,
      amount: `${ledgerAmount}`,
      packet: base64url(packet),
      condition: base64url(condition),
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
});

app.get('*', express.static('app'));

/**
 * Starts the server.
 */
if (module === require.main) {
  let server = app.listen(process.env.PORT || 8081, function() {
    console.log('Server listening on port %s', server.address().port);
  });
}

module.exports = app;
