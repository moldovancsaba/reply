const { resolveOpenClawBinary } = require('./utils/whatsapp-utils');
const fs = require('fs');

console.log('Resolved Binary:', resolveOpenClawBinary());
console.log('Binary Exists:', fs.existsSync(resolveOpenClawBinary()));
