#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { generatePkgbuild } from './generate-pkgbuild.mjs';

const execFile = promisify(execFileCallback);
const REPOSITORY = 'LaT-SKY/mip-paper';

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

async function run(command, arguments_, options = {}) {
  return execFile(command, arguments_, { maxBuffer: 4 * 1024 * 1024, ...options });
}

export function remoteTagCommit(output, tag) {
  const peeled = new Map(output.trim().split('\n').filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/);
    return [ref, commit];
  }));
  return peeled.get(`refs/tags/${tag}^{}`) ?? peeled.get(`refs/tags/${tag}`) ?? null;
}

export async function prepareAurRelease(version, aurDirectory, { fetchImpl = fetch } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new TypeError('VERSION must be semantic x.y.z');
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  if (manifest.version !== version) {
    throw new Error(`package.json is ${manifest.version}, expected ${version}`);
  }

  const tag = `v${version}`;
  const { stdout: aurRoot } = await run('git', ['-C', aurDirectory, 'rev-parse', '--show-toplevel']);
  if (path.resolve(aurRoot.trim()) !== path.resolve(aurDirectory)) {
    throw new Error('AUR_DIRECTORY must be the root of an existing Git repository');
  }
  const { stdout: aurStatus } = await run('git', ['-C', aurDirectory, 'status', '--porcelain']);
  if (aurStatus.trim()) throw new Error('AUR repository must be clean before generation');
  let localCommitOutput;
  try {
    ({ stdout: localCommitOutput } = await run('git', ['rev-parse', `${tag}^{commit}`]));
  } catch {
    throw new Error(`${tag} does not exist locally; freeze and tag the final ${version} commit first`);
  }
  const localCommit = localCommitOutput.trim();
  const { stdout: remoteOutput } = await run('git', [
    'ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`,
  ]);
  const publishedCommit = remoteTagCommit(remoteOutput, tag);
  if (publishedCommit !== localCommit) {
    throw new Error(`${tag} must be pushed to origin at ${localCommit} before packaging`);
  }

  const sourceUrl = `https://github.com/${REPOSITORY}/archive/refs/tags/${tag}.tar.gz`;
  const response = await fetchImpl(sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`archive download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const checksum = createHash('sha256').update(archive).digest('hex');
  const pkgbuild = generatePkgbuild(version, sourceUrl, checksum);

  const stage = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-aur-'));
  try {
    await writeFile(path.join(stage, 'PKGBUILD'), pkgbuild);
    await writeFile(path.join(stage, 'mip-paper.install'), await readFile('packaging/mip-paper.install'));
    await writeFile(path.join(stage, 'LICENSE'), await readFile('packaging/LICENSE'));
    const { stdout: srcinfo } = await run('makepkg', ['--printsrcinfo'], { cwd: stage });
    if (!srcinfo.includes(`pkgver = ${version}`) || !srcinfo.includes(`sha256sums = ${checksum}`)) {
      throw new Error('generated .SRCINFO does not match PKGBUILD');
    }
    await writeFile(path.join(stage, '.SRCINFO'), srcinfo);

    for (const filename of ['PKGBUILD', '.SRCINFO', 'mip-paper.install', 'LICENSE']) {
      const temporary = path.join(aurDirectory, `.${filename}.tmp-${process.pid}`);
      await writeFile(temporary, await readFile(path.join(stage, filename)));
      await rename(temporary, path.join(aurDirectory, filename));
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }

  return { tag, commit: localCommit, sourceUrl, checksum, aurDirectory };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, aurDirectory] = process.argv.slice(2);
  if (!version || !aurDirectory) fail('usage: prepare-aur-release.mjs VERSION AUR_DIRECTORY');
  try {
    const result = await prepareAurRelease(version, path.resolve(aurDirectory));
    process.stdout.write([
      `Prepared ${result.tag} from ${result.commit}`,
      `Source: ${result.sourceUrl}`,
      `SHA-256: ${result.checksum}`,
      `AUR files: ${result.aurDirectory}`,
      'Review PKGBUILD and .SRCINFO, build the package, then commit the AUR repository.',
    ].join('\n') + '\n');
  } catch (error) {
    fail(error.message);
  }
}
