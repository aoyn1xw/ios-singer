const { parentPort, workerData } = require('worker_threads');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { p12Path, p12Password, mpPath, ipaPath, signedIpaPath } = workerData;

// Try to find zsign
let zsignPath;
try {
  // First try system path
  zsignPath = execSync('which zsign', { encoding: 'utf8' }).trim();
} catch (e) {
  // Fall back to local binary
  zsignPath = os.platform() === 'win32' 
    ? path.join(__dirname, 'zsign.exe')
    : path.join(__dirname, 'zsign');
}

let command = `"${zsignPath}" -k "${p12Path}" -m "${mpPath}"`;

if (p12Password) {
  command += ` -p "${p12Password}"`;
}

command += ` -o "${signedIpaPath}" "${ipaPath}"`;

console.log('Running zsign...');

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error('zsign error:', stderr);
    parentPort.postMessage({
      status: 'error',
      error: stderr || error.message
    });
    return;
  }

  console.log('zsign output:', stdout);
  parentPort.postMessage({
    status: 'ok',
    output: stdout
  });
});
