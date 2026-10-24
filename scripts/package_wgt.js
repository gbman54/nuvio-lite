const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const sourceDir = path.join(projectDir, 'tizen-app');
const wgtPath = path.join(projectDir, 'nuvio-lite-tizen3.wgt');
const tizenCli = process.env.TIZEN_CLI || 'tizen';
const profileName = process.env.TIZEN_PROFILE;

if (!profileName) {
  throw new Error('Set TIZEN_PROFILE to the name of your Tizen Studio signing profile before packaging.');
}

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-tizen-wgt-'));
const powershellScript = [
  '& $env:NUVIO_TIZEN_CLI build-web -- $env:NUVIO_TIZEN_SOURCE_DIR',
  'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
  '& $env:NUVIO_TIZEN_CLI package -t wgt -s $env:NUVIO_TIZEN_PROFILE -o $env:NUVIO_TIZEN_OUTPUT_DIR -- (Join-Path $env:NUVIO_TIZEN_SOURCE_DIR ".buildResult")',
  'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
].join('; ');

try {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', powershellScript], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      NUVIO_TIZEN_CLI: tizenCli,
      NUVIO_TIZEN_PROFILE: profileName,
      NUVIO_TIZEN_SOURCE_DIR: sourceDir,
      NUVIO_TIZEN_OUTPUT_DIR: outputDir
    })
  });

  const packages = fs.readdirSync(outputDir).filter(function(file) {
    return path.extname(file).toLowerCase() === '.wgt';
  });
  if (!packages.length) throw new Error('Tizen CLI finished without creating a .wgt package.');

  const temporaryWgtPath = wgtPath + '.tmp';
  fs.copyFileSync(path.join(outputDir, packages[0]), temporaryWgtPath);
  if (fs.existsSync(wgtPath)) fs.unlinkSync(wgtPath);
  fs.renameSync(temporaryWgtPath, wgtPath);
  console.log('Signed Tizen package created:', wgtPath, fs.statSync(wgtPath).size, 'bytes');
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
