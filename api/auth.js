'use strict';

const { verifyRequest } = require('../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const user = await verifyRequest(req);
    send(res, 200, { authenticated: true, user });
  } catch (error) {
    errorResponse(res, error);
  }
};
