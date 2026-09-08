'use strict';

const { waitUntil } = require('@vercel/functions');
const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncItem, syncAllItems } = require('../../lib/pluggy-sync');
const { triggerSyncMentor } = require('../../lib/mentor-trigger');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyRequest(req);
    const itemId = req.body?.itemId ? String(req.body.itemId) : '';
    const result = itemId ? await syncItem(itemId) : await syncAllItems();
    waitUntil(triggerSyncMentor().catch((error) => console.error('Mentor Duo apos sincronizacao:', error)));
    send(res, 200, { synced: true, result, mentorQueued: true });
  } catch (error) {
    errorResponse(res, error);
  }
};
