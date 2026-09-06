'use strict';

const { OAuth2Client } = require('google-auth-library');

let client;

function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function unauthorized(message = 'Sessao invalida ou expirada.') {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

async function verifyRequest(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw unauthorized('Token de acesso ausente.');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID nao configurado.');

  client ||= new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized();
  }

  const email = payload?.email?.toLowerCase();
  if (!payload?.email_verified || !allowedEmails().includes(email)) {
    const error = new Error('Esta conta nao tem acesso ao DuoFinance.');
    error.statusCode = 403;
    throw error;
  }

  return { email, name: payload.name, picture: payload.picture };
}

module.exports = { verifyRequest };
