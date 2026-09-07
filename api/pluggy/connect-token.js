'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const pluggy = require('../../lib/pluggy');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const user = await verifyRequest(req);
    const itemId = req.body?.itemId ? String(req.body.itemId) : undefined;
    send(res, 200, await pluggy.createConnectToken(user.email, itemId));
  } catch (error) {
    errorResponse(res, error);
  }
};
