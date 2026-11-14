'use strict';

function send(res, status, body) {
  res.status(status).json(body);
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  send(res, 405, { error: 'Metodo nao permitido.' });
}

function errorResponse(res, error) {
  // Erros de cliente (401, 400...) são esperados: registramos só a linha; o stack trace fica para erros reais.
  if (!error.statusCode || error.statusCode >= 500) console.error(error);
  else console.info(error.statusCode, error.message);
  const status = error.statusCode || 500;
  send(res, status, {
    error: status >= 500 && status !== 503 ? 'Nao foi possivel concluir a operacao.' : error.message
  });
}

module.exports = { send, methodNotAllowed, errorResponse };
