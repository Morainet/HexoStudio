const { version } = require('../package.json');

const tag = process.argv[2];
if (!tag || tag !== `v${version}`) {
  console.error(`Release tag must match package.json: v${version}`);
  process.exit(1);
}
console.log(`Release version verified: ${tag}`);
