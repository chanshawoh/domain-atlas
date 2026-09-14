import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org';
const registryArgs = [`--registry=${registry}`, '--fetch-retries=0', '--fetch-timeout=15000'];
const root = fileURLToPath(new URL('../', import.meta.url));
const help = `Usage:
  bash script/release.sh            Build, test, audit and verify the npm package.
  bash script/release.sh --publish  Run checks, then publish the verified tarball.

Publication requires main, a clean checkout synchronized with origin/main,
npm authentication and an unpublished stable version. No version bump, commit,
Git push, tag or GitHub Release is created. Failed publication is never retried.
Run --publish in a terminal so npm can prompt for two-factor authentication.
The check mode builds files and installs a tarball in a temporary directory;
it never publishes, changes global hooks or initializes the current project.`;

export function execute(command, args, cwd, { inheritStdio = false } = {}) {
  if (inheritStdio) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code: code ?? 1, stdout: '',
        stderr: signal ? `Process terminated by ${signal}` : '' }));
    });
  }
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

export function registryResult(result) {
  if (result.code === 0) return JSON.parse(result.stdout);
  let code;
  try { code = JSON.parse(result.stdout).error?.code; } catch { /* Not an npm JSON response. */ }
  if (code === 'E404') return null;
  throw new Error(`Registry query failed (${code ?? result.code}); this is not evidence that the version is unpublished.`);
}

export function validatePack(pack, pkg) {
  if (pack.name !== pkg.name || pack.version !== pkg.version) throw new Error('Packed package name/version does not match package.json');
  const files = new Set(pack.files.map(entry => entry.path));
  for (const file of ['package.json', 'README.md', 'dist/src/cli.js', 'dist/src/web/server.js',
    'apps/web/dist/index.html', 'apps/web/dist/domainatlas.svg', 'skills/domainatlas/SKILL.md',
    'skills/domainatlas/agents/openai.yaml']) {
    if (!files.has(file)) throw new Error(`Packed artifact is missing ${file}`);
  }
  for (const extension of ['js', 'css']) {
    if (![...files].some(file => file.startsWith('apps/web/dist/assets/') && file.endsWith('.' + extension))) {
      throw new Error(`Packed Web UI is missing ${extension} assets`);
    }
  }
  for (const file of files) {
    if (file.split('/').some(part => part === '..' || part.startsWith('.env') || part === '.domainatlas') ||
      !/^(?:package\.json|README\.md|LICENSE(?:\.md)?|dist\/src\/.+|apps\/web\/dist\/.+|skills\/.+)$/.test(file)) {
      throw new Error(`Unexpected file in npm package: ${file}`);
    }
  }
}

const smoke = `
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [installed, target] = process.argv.slice(1);
const { createWebServer } = await import(pathToFileURL(path.join(installed, 'dist/src/web/server.js')));
const app = await createWebServer(target);
try {
  const page = await app.inject({ url: '/', headers: { host: 'localhost' } });
  assert.equal(page.statusCode, 200);
  const asset = page.body.match(/src="([^\"]+\\.js)"/)?.[1];
  assert.ok(asset, 'installed UI must serve its built HTML');
  assert.equal((await app.inject({ url: asset, headers: { host: 'localhost' } })).statusCode, 200);
  const data = await app.inject({ url: '/api/atlas', headers: { host: 'localhost' } });
  assert.equal(data.statusCode, 200);
  assert.equal(data.json().project.initialized, false);
  await assert.rejects(access(path.join(target, '.domainatlas')));
} finally { await app.close(); }
console.log('Installed CLI and Web UI smoke checks passed.');
`;

export async function release({ cwd = root, publish = false, run = execute, log = console.log } = {}) {
  async function command(bin, args, directory = cwd, options = {}) {
    const result = await run(bin, args, directory, options);
    if (result.code !== 0) throw new Error(`${bin} ${args[0]} failed (${result.code})\n${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
  async function visible(bin, args, directory = cwd, options = {}) {
    log(`> ${bin} ${args.join(' ')}`);
    const output = await command(bin, args, directory, options);
    if (output) log(output);
  }
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  const web = JSON.parse(await readFile(path.join(cwd, 'apps/web/package.json'), 'utf8'));
  if (pkg.private || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version) || web.version !== pkg.version) {
    throw new Error('Root package must be publishable with a stable x.y.z version matching apps/web/package.json');
  }
  if (pkg.publishConfig?.registry !== registry || pkg.publishConfig?.access !== 'public') throw new Error('Expected public npm Registry publishConfig');
  const expectedPnpm = /^pnpm@(.+)$/.exec(pkg.packageManager)?.[1];
  if (!expectedPnpm || await command('pnpm', ['--version']) !== expectedPnpm) throw new Error('Use the pnpm version pinned in package.json');
  const id = `${pkg.name}@${pkg.version}`;
  log(`Release mode: ${publish ? 'publish' : 'check'}; package: ${id}`);
  let sourceHead;
  async function assertPublishSource() {
    if (await command('git', ['branch', '--show-current']) !== 'main') throw new Error('Publication requires branch main');
    if (await command('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Publication requires a clean working tree');
    const head = await command('git', ['rev-parse', 'HEAD']);
    if (sourceHead && sourceHead !== head) throw new Error('HEAD changed during release checks');
    const remote = await command('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
    if (remote.split(/\s+/)[0] !== head) throw new Error('Local HEAD must equal remote origin/main');
    sourceHead = head;
  }
  if (publish) await assertPublishSource();
  else if (await command('git', ['status', '--porcelain', '--untracked-files=all'])) log('Warning: dirty checkout; --publish would stop.');
  await command('git', ['diff', '--check']);
  await command('git', ['diff', '--cached', '--check']);
  await visible('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
  await visible('pnpm', ['test']);
  await visible('pnpm', ['audit', '--prod', '--audit-level=high', `--registry=${registry}`]);

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'domainatlas-release-'));
  try {
    const packed = JSON.parse(await command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, ...registryArgs]))[0];
    validatePack(packed, pkg);
    if (path.basename(packed.filename) !== packed.filename) throw new Error('Unexpected tarball path');
    const tarball = path.join(temporary, packed.filename);
    const localShasum = createHash('sha1').update(await readFile(tarball)).digest('hex');
    if (packed.shasum !== localShasum) throw new Error('Packed tarball checksum mismatch');
    log(`Pack check passed: ${packed.filename}, ${packed.files.length} files, sha1=${localShasum}`);
    const installRoot = path.join(temporary, 'install');
    await visible('npm', ['install', '--prefix', installRoot, '--no-save', '--package-lock=false', '--omit=dev',
      '--ignore-scripts', '--no-audit', '--no-fund', tarball, ...registryArgs]);
    const bin = path.join(installRoot, 'node_modules/.bin/domainatlas');
    if ((await command(bin, ['-v'], temporary)).trim() !== pkg.version) {
      throw new Error('Installed CLI -v does not match package.json');
    }
    await command(bin, ['init', '--help'], temporary);
    await command(bin, ['upgrade', '--help'], temporary);
    const hookHome = path.join(temporary, 'hooks-preview');
    const preview = JSON.parse(await command(bin, ['init', '-g', '--codex', '--dry-run', '--codex-home', hookHome], temporary));
    if (preview.written !== false) throw new Error('Installed CLI unexpectedly wrote global hooks');
    await command('git', ['init', '--quiet', '-b', 'main'], temporary);
    log(await command(process.execPath, ['--input-type=module', '-e', smoke, path.join(installRoot, 'node_modules', pkg.name), temporary]));
    await visible('npm', ['publish', tarball, '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', 'latest', ...registryArgs]);
    const auth = await run('npm', ['whoami', ...registryArgs], cwd);
    if (auth.code !== 0) {
      if (publish) throw new Error('npm authentication is required; run npm login first');
      log('Warning: npm authentication unavailable; publication requires npm login.');
    }
    async function view(spec) {
      return registryResult(await run('npm', ['view', spec, '--json', '--prefer-online', ...registryArgs], cwd));
    }
    const existing = await view(id);
    if (existing) {
      if (publish) throw new Error(`${id} is already published and cannot be overwritten`);
      if (existing.dist?.shasum !== localShasum) throw new Error(`${id} already exists with different contents; bump the version`);
      log(`Registry package matches the checked tarball: ${id}`);
      return;
    }
    const latest = await view(`${pkg.name}@latest`);
    if (latest) {
      if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(latest.version)) throw new Error('Registry latest is not a stable version; review the release tag manually');
      const compare = pkg.version.split('.').map(BigInt);
      const previous = latest.version.split('.').map(BigInt);
      const firstDifferent = compare.findIndex((value, index) => value !== previous[index]);
      if (firstDifferent < 0 || compare[firstDifferent] < previous[firstDifferent]) throw new Error('Version must be newer than the Registry latest tag');
    }
    if (!publish) { log(`Release checks passed: ${id}. Nothing published.`); return; }
    await assertPublishSource();
    if (createHash('sha1').update(await readFile(tarball)).digest('hex') !== localShasum) throw new Error('Tarball changed after validation');
    // npm's own OTP/web authentication requires inherited stdin AND stdout TTYs.
    // Start one npm process; it handles authentication without exposing OTPs here.
    // Do not repack or restart a failed publish process.
    await visible('npm', ['publish', tarball, '--ignore-scripts', '--access', 'public', '--tag', 'latest', ...registryArgs],
      cwd, { inheritStdio: true });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [exact, tagged] = await Promise.all([view(id), view(`${pkg.name}@latest`)]);
      if (exact?.version === pkg.version && tagged?.version === pkg.version) {
        if (exact.dist?.shasum !== localShasum) throw new Error('Registry shasum differs from the published tarball');
        log(`Published and verified: ${id}; Registry shasum: ${localShasum}`);
        return;
      }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('Publication returned success, but Registry version/latest verification timed out; inspect Registry before retrying');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) console.log(help);
  else if (args.length > 1 || (args.length === 1 && args[0] !== '--publish')) {
    console.error(help); process.exitCode = 2;
  } else {
    await release({ publish: args[0] === '--publish' }).catch(error => {
      console.error(`Release failed: ${error.message}`); process.exitCode = 1;
    });
  }
}
