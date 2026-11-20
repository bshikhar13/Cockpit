// Runs after each app is assembled and before it goes into the disk image.
// There is no Apple Developer ID, so the app gets an ad-hoc signature: it says the bundle is
// intact, which Apple Silicon requires to run it, without claiming to be from a known developer.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
