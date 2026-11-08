'use strict';

const crypto = require('crypto');

// Compara dois segredos em tempo constante. Os dois lados viram SHA-256 antes da comparação,
// assim o tamanho do segredo real não vaza pelo tempo de resposta.
function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

module.exports = { secretsMatch };
