'use strict';

const express = require('express');
const XrpEscrowPlugin = require('ilp-plugin-xrp-escrow');
const IlpPacket = require('ilp-packet');

const app = express();
const plugin = new XrpEscrowPlugin({
        secret: 'snnZw1PPtxCwpK6V1qYW6ZS87sgaH',
        account: 'raZkBcKAkrAxjuDndVcFaeyVnAuxBtAyaf',
        server: 'wss://s.altnet.rippletest.net:51233',
        prefix: 'test.crypto.xrp.',
});

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

app.post('/send-payment', express.json(), (req, res, next) => {
  const data = req.body;

  const transferId = data.paymentRequestId;
  const destinationAmount = data.amount;
  const destinationAddress = data.address;
  const ilpPacket = data.packet;
  const condition = data.condition;

  console.log(`Sending payment of ${destinationAmount} ` +
                `to ${destinationAddress} (tx: ${transferId})`);

  // Define a listener just for this transfer
  const listenerForThisTransfer = function(transfer, fulfillment) {
    console.debug(` - Incoming fulfillment ${fulfillment}`);
    if (transfer.id === transferId) {
      console.log(` - Fulfillment received ${fulfillment}`);
      plugin.removeListener('outgoing_fulfill', listenerForThisTransfer);
      res.json({
        transferId: transferId,
        fulfillment: fulfillment,
      });
      return next();
    }
  };

  // Register the listener
  plugin.addListener('outgoing_fulfill', listenerForThisTransfer);

  plugin.sendTransfer({
    from: plugin.getAccount(),
    ledger: plugin.getInfo().prefix,
    to: destinationAddress,
    amount: destinationAmount,
    executionCondition: condition,
    id: transferId,
    ilp: ilpPacket,
    expiresAt: new Date(new Date().getTime() + 1000000).toISOString(),
  }).then(() => {
        console.log(` - Transfer (tx-id:${transferId}) prepared, ` +
                                            `waiting for fulfillment...`)
  }).catch((err) => {
    console.error(err.message);
    res.end(err);
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
});
app.use(function(req, res, next) {
  res.status(200).links({
    'payment-method-manifest':
    'http://localhost:8080/pay/manifest.json'
    });
    return next();
});
// We are mostly a static website.
app.get('*', express.static('public'));

/**
 * Starts the server.
 */
if (module === require.main) {
  plugin.connect().then(function () {
    const ledgerInfo = plugin.getInfo()
    const account = plugin.getAccount()
    console.log(`Connected to ledger: ${ledgerInfo.prefix}`)
    console.log(` - Account: ${account}`)
    console.log(` - Currency: ${ledgerInfo.currencyCode}`)
    console.log(` - CurrencyScale: ${ledgerInfo.currencyScale}`)

    let server = app.listen(process.env.PORT || 8080, function() {
      console.log('Server listening on port %s', server.address().port);
    });
  });
}

module.exports = app;
