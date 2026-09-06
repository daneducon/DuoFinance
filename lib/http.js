'use strict';

function send(res, status, body) {
  res.status(status).json(body);
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  send(res, 405, { error: 'Metodo nao permitido.' });
}

function errorResponse(res, error) {
  console.error(error);
  const status = error.statusCode || 500;
  send(res, status, {
    error: status >= 500 && status !== 503 ? 'Nao foi possivel concluir a operacao.' : error.message
  });
}

module.exports = { send, methodNotAllowed, errorResponse };
