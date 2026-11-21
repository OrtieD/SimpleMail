const { packager } = require('@electron/packager');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');
(async () => {
  const out = await packager({ dir: path.resolve(__dirname, '../app'), out: path.resolve(__dirname, '../dist'), platform: 'win32', arch: 'x64',
    electronVersion: '45.3.2', asar: true, overwrite: true, name: 'SimpleMail', executableName: 'SimpleMail',
    icon: path.resolve(__dirname, '../app/assets/icon.ico'), appCopyright: 'Ortwin', prune: true,
    win32metadata: { CompanyName: 'Ortwin', FileDescription: 'SimpleMail', ProductName: 'SimpleMail' },
    ignore: [/^\/node_modules\/\.package-lock\.json$/] });
  const exe = path.join(out[0], 'SimpleMail.exe');
  await flipFuses(exe, { version: FuseVersion.V1, resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true });
  console.log('OK', out[0]);
})().catch((e) => { console.error(e); process.exit(1); });
