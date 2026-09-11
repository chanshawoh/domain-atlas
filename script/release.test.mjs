import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execute, registryResult, release, validatePack } from './release.mjs';

const files = ['package.json', 'README.md', 'dist/src/cli.js', 'dist/src/web/server.js',
  'apps/web/dist/index.html', 'apps/web/dist/domainatlas.svg', 'apps/web/dist/assets/app.js',
  'apps/web/dist/assets/app.css', 'skills/domainatlas/SKILL.md', 'skills/domainatlas/agents/openai.yaml'];
const pkg = { name: 'domainatlas', version: '0.1.0', packageManager: 'pnpm@11.13.0',
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' } };
const pack = () => ({ name: pkg.name, version: pkg.version, files: files.map(path => ({ path })) });
const success = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const json = value => success(JSON.stringify(value));
const missing = () => ({ code: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' });

test('package validation requires CLI, UI and skill assets and rejects private/project files', () => {
  validatePack(pack(), pkg);
  for (const file of ['.domainatlas/changes/private.json', '.codex/hooks.json', 'dist/tests/private.test.js',
    'src/cli.ts', 'docs/.env', 'skills/../secret', 'node_modules/secret']) {
    assert.throws(() => validatePack({ ...pack(), files: [...pack().files, { path: file }] }, pkg), /Unexpected file/);
  }
  for (const file of files) {
    assert.throws(() => validatePack({ ...pack(), files: pack().files.filter(entry => entry.path !== file) }, pkg), /missing/);
  }
  assert.throws(() => validatePack({ ...pack(), version: '0.2.0' }, pkg), /does not match/);
});

test('Registry treats only an explicit E404 as absent, never authentication or network errors', () => {
  assert.equal(registryResult(missing()), null);
  assert.deepEqual(registryResult(json({ version: '0.1.0' })), { version: '0.1.0' });
  for (const code of ['E403', 'E401', 'E500', 'ENOTFOUND', 'ETIMEDOUT']) {
    assert.throws(() => registryResult({ code: 1, stdout: JSON.stringify({ error: { code } }) }), /not evidence/);
  }
  assert.throws(() => registryResult({ code: 1, stdout: 'invalid response' }), /not evidence/);
});

async function fixture(t, options = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'atlas-release-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'apps/web'), { recursive: true });
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkg));
  await writeFile(path.join(cwd, 'apps/web/package.json'), JSON.stringify({ version: pkg.version }));
  const calls = [];
  let published = false;
  let statusChecks = 0;
  const archive = Buffer.from('the one verified package archive');
  const shasum = createHash('sha1').update(archive).digest('hex');
  async function run(bin, args, directory, execution = {}) {
    calls.push({ bin, args, directory, execution });
    if (bin === 'pnpm' && args[0] === '--version') return success('11.13.0');
    if (bin === 'pnpm' && args[0] === 'test' && options.testFailure) return { code: 1, stdout: '', stderr: 'test failed' };
    if (bin === 'git') {
      if (args[0] === 'branch') return success(options.branch ?? 'main');
      if (args[0] === 'status') return success(options.dirty || (options.changedDuringChecks && ++statusChecks > 1) ? ' M README.md' : '');
      if (args[0] === 'rev-parse') return success('abc123');
      if (args[0] === 'ls-remote') return success(`${options.remoteHead ?? 'abc123'}\trefs/heads/main`);
      return success();
    }
    if (bin === 'npm') {
      if (args[0] === 'pack') {
        const destination = args[args.indexOf('--pack-destination') + 1];
        const filename = 'domainatlas-0.1.0.tgz';
        await writeFile(path.join(destination, filename), archive);
        return json([{ ...pack(), filename, shasum }]);
      }
      if (args[0] === 'whoami') return options.noAuth ? { code: 1, stdout: '', stderr: '' } : success('test-user');
      if (args[0] === 'view') {
        if (options.registryError) return { code: 1, stdout: JSON.stringify({ error: { code: options.registryError } }) };
        if (published || options.alreadyPublished) return json({ version: pkg.version, dist: { shasum: options.badShasum ? 'different' : shasum } });
        if (args[1].endsWith('@latest') && options.latest) return json({ version: options.latest });
        return missing();
      }
      if (args[0] === 'publish' && !args.includes('--dry-run')) {
        if (options.publishFailure) return { code: 1, stdout: '', stderr: 'publish failed' };
        published = true;
      }
      return success();
    }
    if (bin.endsWith('/.bin/domainatlas') && args.includes('--dry-run')) return json({ written: false });
    return success();
  }
  const publishCalls = () => calls.filter(call => call.bin === 'npm' && call.args[0] === 'publish' && !call.args.includes('--dry-run'));
  return { cwd, run, calls, publishCalls, log: () => {} };
}

test('check mode exercises the package without publishing even when npm authentication is absent', async t => {
  const context = await fixture(t, { dirty: true, noAuth: true });
  await release(context);
  assert.equal(context.publishCalls().length, 0);
  assert.ok(context.calls.some(call => call.bin === 'npm' && call.args.includes('--dry-run')));
  assert.ok(context.calls.some(call => call.bin === 'npm' && call.args[0] === 'install' && call.args.includes('--omit=dev')));
  assert.ok(context.calls.every(call => !call.execution.inheritStdio));
});

test('publication guards stop dirty, divergent, unauthenticated, failing or already-published releases', async t => {
  for (const options of [{ dirty: true }, { branch: 'feature' }, { remoteHead: 'def456' }, { testFailure: true },
    { noAuth: true }, { alreadyPublished: true }, { registryError: 'E403' }, { latest: '0.2.0' }, { changedDuringChecks: true }]) {
    const context = await fixture(t, options);
    await assert.rejects(release({ ...context, publish: true }));
    assert.equal(context.publishCalls().length, 0, JSON.stringify(options));
  }
});

test('publication sends the single smoke-tested archive, verifies Registry, and never changes Git history', async t => {
  const context = await fixture(t);
  await release({ ...context, publish: true });
  assert.equal(context.publishCalls().length, 1);
  assert.equal(context.publishCalls()[0].execution.inheritStdio, true);
  assert.equal(context.calls.filter(call => call.execution.inheritStdio).length, 1);
  const file = context.publishCalls()[0].args[1];
  assert.ok(file.endsWith('domainatlas-0.1.0.tgz'));
  assert.ok(context.calls.some(call => call.bin === 'npm' && call.args[0] === 'install' && call.args.includes(file)));
  assert.ok(context.calls.some(call => call.bin === 'npm' && call.args[0] === 'publish' && call.args[1] === file && call.args.includes('--dry-run')));
  assert.ok(!context.calls.some(call => call.bin === 'git' && ['commit', 'push', 'tag', 'reset', 'rebase'].includes(call.args[0])));
  assert.equal(context.calls.filter(call => call.bin === 'git' && call.args[0] === 'ls-remote').length, 2);
});

test('interactive command execution reports nonzero exits, interruption and missing executables', async () => {
  const options = { inheritStdio: true };
  assert.equal((await execute(process.execPath, ['-e', 'process.exit(0)'], process.cwd(), options)).code, 0);
  assert.equal((await execute(process.execPath, ['-e', 'process.exit(7)'], process.cwd(), options)).code, 7);
  const interrupted = await execute(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], process.cwd(), options);
  assert.notEqual(interrupted.code, 0);
  assert.match(interrupted.stderr, /SIGTERM/);
  await assert.rejects(execute('/nonexistent/domainatlas-test-command', [], process.cwd(), options), { code: 'ENOENT' });
});

test('failed publication is not retried and a post-publication checksum mismatch is reported', async t => {
  for (const options of [{ publishFailure: true }, { badShasum: true }]) {
    const context = await fixture(t, options);
    await assert.rejects(release({ ...context, publish: true }));
    assert.equal(context.publishCalls().length, 1);
  }
});
