const { parseArgs } = require('node:util');
const path = require('node:path');
const { isIP } = require('node:net');
const { version } = require('../package.json');

const HELP = `HexoStudio ${version} — Hexo blog management

Usage: hexostudio [start] [options]

Options:
  -p, --port <port>       Port (default: 4545; 0 chooses an available port)
      --host <address>    Listen address (default: 127.0.0.1)
      --root <directory>  Hexo source directory; locks project selection
      --settings <file>   Settings file (default: ~/.hexostudio.json)
  -h, --help              Show help
  -v, --version           Show version

Options override HEXOSTUDIO_PORT, HEXOSTUDIO_HOST, HEXO_ROOT and
HEXOSTUDIO_SETTINGS. Relative paths resolve from your current directory.
Non-loopback listening requires HEXOSTUDIO_TOKEN in the environment.
Use Ctrl+C to stop. Database and administrator setup happen in the browser.
`;

function parseOptions(args, env = process.env, cwd = process.cwd()) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    port: { type: 'string', short: 'p' }, host: { type: 'string' },
    root: { type: 'string' }, settings: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
  } });
  if (positionals.length > 1 || (positionals.length && !['start', 'help'].includes(positionals[0]))) {
    throw new Error('Unknown command. Use hexostudio --help.');
  }
  if (values.help || positionals[0] === 'help') return { help: true };
  if (values.version) return { version: true };
  const rawPort = values.port ?? env.HEXOSTUDIO_PORT ?? '4545';
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(Number(rawPort)) || Number(rawPort) > 65535) {
    throw new Error('Port must be an integer between 0 and 65535.');
  }
  const host = values.host ?? env.HEXOSTUDIO_HOST ?? '127.0.0.1';
  if (host !== 'localhost' && !isIP(host)) throw new Error('Host must be localhost or an IP address.');
  const resolveOption = (key, variable) => {
    const value = values[key] ?? env[variable];
    if (value === undefined) return undefined;
    if (!value.trim()) throw new Error(`--${key} must not be empty.`);
    return path.resolve(cwd, value);
  };
  return { port: Number(rawPort), host, root: resolveOption('root', 'HEXO_ROOT'), settings: resolveOption('settings', 'HEXOSTUDIO_SETTINGS') };
}

async function main(args = process.argv.slice(2)) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 or newer is required.');
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  if (options.version) { console.log(version); return; }
  process.env.HEXOSTUDIO_HOST = options.host;
  process.env.HEXOSTUDIO_PORT = String(options.port);
  if (options.root) process.env.HEXO_ROOT = require('./core.cjs').validateProject(options.root);
  if (options.settings) process.env.HEXOSTUDIO_SETTINGS = options.settings;
  let running;
  try { running = await require('./index.cjs').startServer(options.port, options.host); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${options.port} is already in use. Choose another port with --port.`);
    if (error.code === 'EACCES') throw new Error('Cannot listen on this address or port. Try a port above 1024.');
    throw error;
  }
  const { server, url } = running;
  console.log(`HexoStudio: ${url}`);
  console.log('Press Ctrl+C to stop.');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => server.closeAllConnections(), 5000);
    timeout.unref();
    server.close(() => { clearTimeout(timeout); });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.once('close', () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  });
  return running;
}

module.exports = { parseOptions, main };
