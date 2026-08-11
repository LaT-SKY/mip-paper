import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('uses system Electron for source and packaged installations', async () => {
  const [packageJson, sourceUnit, packagedUnit, wrapper] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('resources/mip-paper.service.in', 'utf8'),
    readFile('resources/mip-paper-packaged.service', 'utf8'),
    readFile('packaging/mip-paper', 'utf8'),
  ]);

  assert.equal(packageJson.dependencies.electron, undefined);
  assert.equal(packageJson.devDependencies.electron, '43.3.0');
  assert.match(sourceUnit, /ExecStart=@ELECTRON@ @INSTALL_ROOT@/);
  assert.match(packagedUnit, /ExecStart=\/usr\/bin\/electron43 \/usr\/lib\/mip-paper/);
  assert.match(packagedUnit, /WorkingDirectory=\/usr\/lib\/mip-paper/);
  assert.doesNotMatch(packagedUnit, /node_modules\/electron/);
  for (const required of [
    'MIP_PAPER_MODE=packaged',
    'MIP_PAPER_SOURCE_ROOT=/usr/lib/mip-paper',
    'MIP_PAPER_INSTALL_ROOT=/usr/lib/mip-paper',
    'MIP_PAPER_SERVICE_PATH=/usr/lib/systemd/user/mip-paper.service',
    'MIP_PAPER_KWIN_SOURCE=/usr/share/kwin/scripts/mip-paper',
  ]) {
    assert.ok(wrapper.includes(required), `packaged wrapper is missing: ${required}`);
  }
  assert.match(wrapper, /exec \/usr\/lib\/mip-paper\/bin\/mip-paper "\$@"/);
});
