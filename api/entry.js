// Vercel Node.js Function. Cloud mode never starts a listening server.
process.env.HEXOSTUDIO_MODE = 'cloud';
module.exports = require('../server/index.cjs').handle;
