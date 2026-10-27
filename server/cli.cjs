const { parseArgs } = require('node:util');
const path = require('node:path');
const os = require('node:os');
const { isIP } = require('node:net');
const { version } = require('../package.json');

const HELP = `HexoStudio ${version} — Hexo blog management

Usage: hs [start] [options]
       hs <command> --help

Commands:
  start                 Start in the foreground (Ctrl+C to stop)
  start -d              Start a managed background service
  status                Show managed service status
  stop                  Stop the managed background service
  restart               Restart it with its saved startup options
  open                  Open the running managed workspace in a browser
  logs                  Show recent background service logs
  doctor                Check settings, tools and the Hexo project
  config path           Print the settings file path (never its secrets)
  help [command]        Show command help
  version               Show version

Common options:
      --settings <file> Select an instance (default: ~/.hexostudio.json)
  -h, --help            Show help
  -v, --version         Show version

Examples:
  hs start --root /path/to/blog --open
  hs start -d --port 4546
  hs status --json
  hs logs --lines 100
  hs stop

Use hs start --help for environment variables and listening options.
Database and administrator setup happen in the browser.
`;
const COMMAND_HELP = {
  start: `Usage: hs start [options]
  -p, --port <port>       Port (default: 4545; 0 selects an available port)
      --host <address>    IP or localhost (default: 127.0.0.1)
      --root <directory>  Lock the workspace to a Hexo source directory
      --settings <file>   Settings file / instance
  -d, --background        Run a managed local service in the background
      --open              Open the workspace after successful startup

Options override HEXOSTUDIO_PORT, HEXOSTUDIO_HOST, HEXO_ROOT and
HEXOSTUDIO_SETTINGS; PORT is also accepted. Paths resolve from the caller.
Non-loopback local listening requires HEXOSTUDIO_TOKEN.
Cloud mode uses HEXOSTUDIO_MODE=cloud; run it in the foreground under your
hosting platform or process supervisor. See docs/cloud-deployment.md.
Foreground: Ctrl+C stops. Background: hs stop --settings <same file>.`,
  status: 'Usage: hs status [--settings <file>] [--json]\nReports only a managed background service. Exit codes: 0 running, 1 stopped, 2 unreachable.',
  stop: 'Usage: hs stop [--settings <file>]\nStops only the authenticated service started by hs start -d. Stopping an already stopped instance succeeds.',
  restart: 'Usage: hs restart [--settings <file>] [--open]\nRestarts a managed service using its saved host, port and blog directory.',
  open: 'Usage: hs open [--settings <file>]\nOpens a running managed service in your default browser.',
  logs: 'Usage: hs logs [--settings <file>] [--lines <1-1000>]\nPrints the latest log lines (default: 50, at most 256 KB).',
  doctor: 'Usage: hs doctor [--root <directory>] [--settings <file>] [--json]\nChecks local files and tools without changing them, connecting to a database or starting a service.',
  config: 'Usage: hs config path [--settings <file>]\nPrints the resolved settings path. Edit account and database settings in the workspace; secrets are never printed.'
};
function help(command) {
  if (!command) return HELP;
  if (!COMMAND_HELP[command]) throw new Error(`Unknown command "${command}". Use hs --help.`);
  return `HexoStudio ${version}\n\n${COMMAND_HELP[command]}\n`;
}

function parseOptions(args, env = process.env, cwd = process.cwd()) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    port: { type:'string', short:'p' }, host: { type:'string' }, root: { type:'string' }, settings: { type:'string' },
    background: { type:'boolean', short:'d' }, open: { type:'boolean' }, lines: { type:'string' },
    help: { type:'boolean', short:'h' }, version: { type:'boolean', short:'v' }, json: { type:'boolean' }
  } });
  let command=positionals[0]||'start';
  if(command==='help') {
    if(positionals.length>2)throw new Error('Use hs help [command].');
    help(positionals[1]);return {help:positionals[1]||true};
  }
  if(command==='version'&&positionals.length===1||values.version)return {version:true};
  if(!COMMAND_HELP[command]||positionals.length>(command==='config'?2:1))throw new Error(`Unknown command "${positionals.join(' ')}". Use hs --help.`);
  if(values.help)return {help:positionals.length?command:true};
  if(command==='config'&&positionals[1]!=='path')throw new Error('Use hs config path.');
  const allowed={start:['port','host','root','settings','background','open'],doctor:['root','settings','json'],status:['settings','json'],stop:['settings'],restart:['settings','open'],open:['settings'],logs:['settings','lines'],config:['settings']};
  for(const key of Object.keys(values))if(!allowed[command].includes(key))throw new Error(`--${key} is not supported by ${command}. Use hs ${command} --help. --json is available with doctor and status.`);
  const resolveOption = (key, variable) => {
    const value = values[key] ?? env[variable];
    if (value === undefined) return undefined;
    if (!value.trim()) throw new Error(`--${key} must not be empty.`);
    if (value === '~') return os.homedir();
    if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) return path.resolve(os.homedir(), value.slice(2));
    return path.resolve(cwd, value);
  };
  const paths = { root: ['start','doctor'].includes(command)?resolveOption('root', 'HEXO_ROOT'):undefined, settings: resolveOption('settings', 'HEXOSTUDIO_SETTINGS') };
  if(command==='doctor')return {doctor:true,json:Boolean(values.json),...paths};
  if(command!=='start') {
    const result={command,settings:paths.settings};
    if(command==='status')result.json=Boolean(values.json);
    if(command==='restart')result.open=Boolean(values.open);
    if(command==='logs') {
      if(values.lines!==undefined&&!/^(?:[1-9]\d{0,2}|1000)$/.test(values.lines))throw new Error('--lines must be an integer between 1 and 1000.');
      result.lines=Number(values.lines||50);
    }
    return result;
  }
  const rawPort = values.port ?? env.HEXOSTUDIO_PORT ?? env.PORT ?? '4545';
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(Number(rawPort)) || Number(rawPort) > 65535) {
    throw new Error('Port must be an integer between 0 and 65535.');
  }
  const host = values.host ?? env.HEXOSTUDIO_HOST ?? '127.0.0.1';
  if (host !== 'localhost' && !isIP(host)) throw new Error('Host must be localhost or an IP address.');
  return { port: Number(rawPort), host, ...paths, ...(values.background?{background:true}:{}), ...(values.open?{open:true}:{}) };
}

async function main(args = process.argv.slice(2)) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 or newer is required.');
  const options = parseOptions(args);
  if (options.help) { console.log(help(options.help===true?undefined:options.help)); return; }
  if (options.version) { console.log(version); return; }
  options.settings ||= path.join(os.homedir(), '.hexostudio.json');
  const { readSettings, diagnose } = require('./diagnostics.cjs');
  const cloud = process.env.HEXOSTUDIO_MODE === 'cloud';
  if (options.doctor) {
    let report;
    if (cloud) {
      try { require('./cloud-store.cjs').cloudConfig(); report = { ok:true, checks:[{id:'cloud',status:'ok',message:'Cloud environment configuration is valid.'}] }; }
      catch { report = { ok:false, checks:[{id:'cloud',status:'error',message:'Check HEXOSTUDIO_DATABASE_URL, HEXOSTUDIO_SECRET, HEXOSTUDIO_SETUP_KEY and HEXOSTUDIO_ORIGIN.'}] }; }
    } else report = diagnose(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`HexoStudio ${version} — diagnostics`);
      for (const check of report.checks) console.log(`[${check.status.toUpperCase()}] ${check.message}`);
      console.log('Database connectivity and port availability were not tested. No files were changed.');
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const service=require('./cli-service.cjs');
  if(options.command==='config'){console.log(options.settings);return;}
  if(options.command) {
    if(cloud)throw new Error('Service management is available in local mode. Use your hosting platform to manage cloud services.');
    if(options.command==='logs'){process.stdout.write(service.logs(options.settings,options.lines));return;}
    let result;
    if(options.command==='stop')result=await service.stop(options.settings);
    else if(options.command==='restart')result=await service.restart(options);
    else result=await service.status(options.settings);
    if(options.json)console.log(JSON.stringify(result,null,2));
    else {
      console.log(`HexoStudio: ${result.status}${result.url?` · ${result.url}`:''}`);
      if(result.pid)console.log(`PID: ${result.pid} | Version: ${result.version}`);
      console.log(`Settings: ${result.settings}`);
      console.log(`Logs: ${result.log}`);
    }
    if(options.command==='open'||options.open) {
      if(result.status!=='running')throw new Error('No managed service is running. Use hs start -d first.');
      await service.openBrowser(result.url);
    }
    if(options.command==='status')process.exitCode=result.status==='running'?0:result.status==='stopped'?1:2;
    return result;
  }
  if(options.background) {
    if(cloud)throw new Error('Use foreground mode with your cloud hosting platform or process supervisor.');
    readSettings(options.settings);
    if(options.root)require('./core.cjs').validateProject(options.root);
    const result=await service.start(options);
    console.log(`HexoStudio: ${result.url}`);
    console.log(result.alreadyRunning?'Background service is already running.':'Background service started.');
    console.log(`PID: ${result.pid} | Logs: ${result.log}`);
    console.log('Use hs stop with the same --settings file to stop.');
    if(options.open)await service.openBrowser(result.url);
    return result;
  }
  return startForeground(options);
}

async function startForeground(options, signals=true) {
  const cloud=process.env.HEXOSTUDIO_MODE==='cloud';
  const {readSettings}=require('./diagnostics.cjs');
  if (cloud) {
    require('./cloud-store.cjs').cloudConfig();
    if (options.root) throw new Error('Cloud mode uses remote repositories; --root is not supported.');
  } else readSettings(options.settings);
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
  const browserUrl = options.host === '0.0.0.0' ? url.replace('0.0.0.0', '127.0.0.1') : options.host === '::' ? url.replace('[::]', '[::1]') : url;
  console.log(`HexoStudio: ${browserUrl}`);
  console.log(`Version: ${version} | Listening: ${options.host}:${server.address().port}`);
  console.log(cloud ? 'Cloud mode: settings and sessions are stored in the database.' : `Settings: ${options.settings}`);
  if (options.root) console.log(`Blog: ${options.root}`);
  else console.log('Select or change your blog in the browser.');
  console.log(signals?'Press Ctrl+C to stop.':'Managed background service. Use hs stop.');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => server.closeAllConnections(), 5000);
    timeout.unref();
    server.close(() => { clearTimeout(timeout); });
  };
  if(signals){process.once('SIGINT', stop);process.once('SIGTERM', stop);}
  server.once('close', () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  });
  if(options.open&&signals) {try{await require('./cli-service.cjs').openBrowser(browserUrl);}catch(error){console.error(error.message);}}
  return {...running,browserUrl};
}

module.exports = { parseOptions, main, startForeground };
