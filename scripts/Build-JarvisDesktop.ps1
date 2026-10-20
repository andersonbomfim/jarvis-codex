param([switch]$Stage)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$desktopVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot '.local/desktop/sdk/version.txt') -Raw).Trim()
$desktopSdk = Join-Path $desktopRoot ('.local/desktop/sdk/' + $desktopVersion)
$desktopApp = Join-Path $desktopRoot $(if ($Stage) { '.local/desktop/staging' } else { '.local/desktop/app' })
New-Item -ItemType Directory -Path $desktopApp -Force | Out-Null
foreach ($desktopDll in 'Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll') {
  Copy-Item -LiteralPath (Join-Path $desktopSdk ('lib/net462/' + $desktopDll)) -Destination $desktopApp -Force
}
Copy-Item -LiteralPath (Join-Path $desktopSdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $desktopApp -Force
$desktopCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $desktopCompiler /nologo /target:winexe /platform:x64 /optimize+ ('/out:' + (Join-Path $desktopApp 'Jarvis.exe')) ('/win32icon:' + (Join-Path $desktopRoot 'public/favicon.ico')) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll ('/reference:' + (Join-Path $desktopApp 'Microsoft.Web.WebView2.Core.dll')) ('/reference:' + (Join-Path $desktopApp 'Microsoft.Web.WebView2.WinForms.dll')) (Join-Path $desktopRoot 'desktop/JarvisDesktop.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o aplicativo Jarvis.' }
Write-Output (Join-Path $desktopApp 'Jarvis.exe')
