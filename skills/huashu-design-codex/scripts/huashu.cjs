const fs = require('node:fs');
const path = require('node:path');
const { Problem } = require('./runtime.cjs');

const statuses = { passed: 0, failed: 1, skipped: 2, partial: 3 };
const commands = { web: 'browser', deck: 'deck', video: 'video', images: 'images', gate: 'gate' };

async function main() {
  const [command, input, output, ...options] = process.argv.slice(2);
  if (!Object.hasOwn(commands, command) || !input || !output ||
      (options.length && !(command === 'gate' && options.length === 1 && options[0] === '--fixture'))) {
    console.error('Usage: node huashu.cjs <web|deck|video|images|gate> <job.json> <new-output-dir> [--fixture for gate only]');
    return 1;
  }
  const deadline = setTimeout(() => { console.error('TIMEOUT: Huashu verification exceeded 180 seconds.'); process.exit(124); }, 180000);
  deadline.unref();
  const out = path.resolve(output);
  try {
    fs.mkdirSync(out); // Exclusive: even an empty existing directory may be another run's.
  } catch (error) {
    console.error(`${error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_ERROR'}: ${error.message}`);
    return 1;
  }
  const report = { schema: 1, command, status: 'passed', issues: [], checks: {}, artifacts: [] };
  const issue = (code, message, detail = {}, severity = 'error') => {
    if (report.issues.length < 100) report.issues.push({ code, message, ...detail, severity });
    if (severity === 'error' && report.status === 'passed') report.status = 'failed';
  };
  const publish = (name, bytes) => {
    fs.writeFileSync(path.join(out, name), bytes, { flag: 'wx' });
    report.artifacts.push(name);
  };
  try {
    const configPath = fs.realpathSync(input);
    if (fs.statSync(configPath).size > 2 * 1024 * 1024) throw new Problem('INVALID_JOB', 'Manifest exceeds 2 MiB.');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Problem('INVALID_JOB', 'Expected a JSON object.');
    await require(`./${commands[command]}.cjs`)[command]({ config, root: path.dirname(configPath), out, report, issue, publish, fixture: options.includes('--fixture') });
  } catch (error) {
    const known = error instanceof Problem;
    issue(known ? error.code : 'JOB_ERROR', error.message);
    report.status = known ? error.status : 'failed';
    if (report.artifacts.length && report.status === 'skipped') report.status = 'partial';
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`${command}: ${report.status} (${report.issues.length} issue(s)); ${path.join(out, 'result.json')}`);
  return statuses[report.status];
}

main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
