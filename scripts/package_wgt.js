const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const sourceDir = path.join(projectDir, 'tizen-app');
const wgtPath = path.join(projectDir, 'nuvio-lite-tizen3.wgt');
const temporaryZipPath = path.join(projectDir, 'nuvio-lite-tizen3.tmp.zip');

if (fs.existsSync(temporaryZipPath)) fs.unlinkSync(temporaryZipPath);

const powershellScript = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  '$sourceDir = $env:NUVIO_TIZEN_SOURCE_DIR',
  '$archivePath = $env:NUVIO_TIZEN_ARCHIVE_PATH',
  '[System.IO.Compression.ZipFile]::CreateFromDirectory($sourceDir, $archivePath, [System.IO.Compression.CompressionLevel]::Optimal, $false)'
].join('; ');

try {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', powershellScript], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      NUVIO_TIZEN_SOURCE_DIR: sourceDir,
      NUVIO_TIZEN_ARCHIVE_PATH: temporaryZipPath
    })
  });

  if (fs.existsSync(wgtPath)) fs.unlinkSync(wgtPath);
  fs.renameSync(temporaryZipPath, wgtPath);
  console.log('Package created:', wgtPath, fs.statSync(wgtPath).size, 'bytes');
} catch (err) {
  if (fs.existsSync(temporaryZipPath)) fs.unlinkSync(temporaryZipPath);
  throw err;
}
