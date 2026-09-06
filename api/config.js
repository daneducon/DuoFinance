'use strict';

const { send, methodNotAllowed } = require('../lib/http');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  res.setHeader('Cache-Control', 'public, max-age=300');
  send(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
};
