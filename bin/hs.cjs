#!/usr/bin/env node

require('../server/cli.cjs').main().catch(error => {
  console.error(`HexoStudio: ${error.message}`);
  process.exitCode = 1;
});
