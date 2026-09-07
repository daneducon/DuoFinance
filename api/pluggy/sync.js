'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncItem, syncAllItems } = require('../../lib/pluggy-sync');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyRequest(req);
    const itemId = req.body?.itemId ? String(req.body.itemId) : '';
    const result = itemId ? await syncItem(itemId) : await syncAllItems();
    send(res, 200, { synced: true, result });
  } catch (error) {
    errorResponse(res, error);
  }
};
