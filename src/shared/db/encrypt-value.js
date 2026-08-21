/**
 * Helper CLI para cifrar un valor (típicamente "email:token" de Alegra).
 *
 * Uso:
 *   node src/shared/db/encrypt-value.js "alegra@email.com:abc123token"
 *
 * Devuelve el valor cifrado, listo para insertarlo en la BD:
 *   UPDATE tenants SET billing_api_key = '<output>' WHERE id = '<tenant>';
 */

require('dotenv').config();
const { encrypt } = require('../utils/crypto');

const value = process.argv[2];
if (!value) {
  console.error('Uso: node src/shared/db/encrypt-value.js "email:token"');
  process.exit(1);
}

try {
  const ciphertext = encrypt(value);
  console.log(ciphertext);
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
