param([string]$Version='0.1.4',[string]$ExistingWebViewSdk)
$ErrorActionPreference='Stop'
$buildRoot=Split-Path -Parent $PSScriptRoot
$buildStage=Join-Path $buildRoot ('.build\payload-'+[guid]::NewGuid().ToString('N'))
$buildRelease=Join-Path $buildRoot 'release'
New-Item -ItemType Directory -Path $buildStage,$buildRelease -Force|Out-Null
foreach($buildFolder in @('dist','assets','bridge','shared','desktop','scripts','installer','public','docs')){Copy-Item -LiteralPath (Join-Path $buildRoot $buildFolder) -Destination (Join-Path $buildStage $buildFolder) -Recurse -Force}
foreach($buildFile in @('package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md')){Copy-Item -LiteralPath (Join-Path $buildRoot $buildFile) -Destination $buildStage}
$buildSdkVersion='1.0.4258.31'
if($ExistingWebViewSdk){$buildSdk=$ExistingWebViewSdk}else{
 $buildSdk=Join-Path $buildRoot ('.build\webview2-'+$buildSdkVersion)
 if(-not(Test-Path -LiteralPath $buildSdk)){
  $buildNuget=Join-Path $buildRoot '.build\webview2.zip'
  Invoke-WebRequest ('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/'+$buildSdkVersion+'/microsoft.web.webview2.'+$buildSdkVersion+'.nupkg') -OutFile $buildNuget -UseBasicParsing
  Expand-Archive -LiteralPath $buildNuget -DestinationPath $buildSdk
 }
}
$buildApp=Join-Path $buildStage '.local\desktop\app'
New-Item -ItemType Directory -Path $buildApp -Force|Out-Null
foreach($buildDll in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')){Copy-Item -LiteralPath (Join-Path $buildSdk ('lib\net462\'+$buildDll)) -Destination $buildApp}
Copy-Item -LiteralPath (Join-Path $buildSdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $buildApp
Get-ChildItem -LiteralPath $buildSdk -File|Where-Object{$_.Name -match 'LICENSE|NOTICE'}|Copy-Item -Destination $buildApp
$buildCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $buildCompiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ ('/out:'+(Join-Path $buildApp 'Jarvis.exe')) ('/win32icon:'+(Join-Path $buildRoot 'public\favicon.ico')) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll ('/reference:'+(Join-Path $buildApp 'Microsoft.Web.WebView2.Core.dll')) ('/reference:'+(Join-Path $buildApp 'Microsoft.Web.WebView2.WinForms.dll')) (Join-Path $buildRoot 'desktop\JarvisDesktop.cs')
if($LASTEXITCODE -ne 0){throw 'Falha ao compilar o aplicativo.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$buildPayload=Join-Path (Split-Path -Parent $buildStage) ('payload-'+[guid]::NewGuid().ToString('N')+'.zip')
$buildZipFile=[IO.File]::Create($buildPayload)
$buildZip=New-Object IO.Compression.ZipArchive($buildZipFile,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($buildEntry in Get-ChildItem -LiteralPath $buildStage -File -Recurse -Force){
  $buildEntryName=$buildEntry.FullName.Substring($buildStage.Length+1).Replace('\','/')
  if($buildEntryName -match '(^|/)(__pycache__|\.pytest_cache)/' -or $buildEntryName -match '\.py[co]$'){continue}
  $buildZipEntry=$buildZip.CreateEntry($buildEntryName,[IO.Compression.CompressionLevel]::Optimal)
  $buildInput=[IO.File]::OpenRead($buildEntry.FullName);$buildOutput=$buildZipEntry.Open()
  try{$buildInput.CopyTo($buildOutput)}finally{$buildOutput.Dispose();$buildInput.Dispose()}
 }
}finally{$buildZip.Dispose();$buildZipFile.Dispose()}
$buildInstaller=Join-Path $buildRelease ('Jarvis-Setup-'+$Version+'.exe')
& $buildCompiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ ('/out:'+$buildInstaller) ('/win32icon:'+(Join-Path $buildRoot 'public\favicon.ico')) ('/resource:'+$buildPayload+',Jarvis.Payload') /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $buildRoot 'installer\Setup.cs')
if($LASTEXITCODE -ne 0){throw 'Falha ao compilar o instalador.'}
$buildVerification=New-Object Diagnostics.Process
$buildVerification.StartInfo=New-Object Diagnostics.ProcessStartInfo($buildInstaller,'--verify-payload')
$buildVerification.StartInfo.UseShellExecute=$false;$buildVerification.StartInfo.CreateNoWindow=$true
[void]$buildVerification.Start();$buildVerification.WaitForExit()
if($buildVerification.ExitCode -ne 0){throw ('O instalador não validou seu pacote. Código: '+$buildVerification.ExitCode)}
$buildVerification.Dispose()
Copy-Item -LiteralPath $buildPayload -Destination (Join-Path $buildRelease ('Jarvis-Portable-'+$Version+'.zip'))
Get-ChildItem -LiteralPath $buildRelease -File|Where-Object{$_.Extension -in @('.exe','.zip')}|ForEach-Object{((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name)}|Set-Content -LiteralPath (Join-Path $buildRelease 'SHA256SUMS.txt') -Encoding ASCII
Write-Output $buildInstaller
