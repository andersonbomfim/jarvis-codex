param([Parameter(Mandatory=$true)][string]$Destination,[Parameter(Mandatory=$true)][string]$ProfilePath,[switch]$Microphone)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$installRoot=[IO.Path]::GetFullPath($Destination)
if(-not(Test-Path -LiteralPath (Join-Path $installRoot 'package.json'))){throw 'Pacote incompleto.'}
$installRuntime=Join-Path $installRoot '.runtime'
New-Item -ItemType Directory -Path $installRuntime -Force|Out-Null
function Checked-Run([string]$Program,[string[]]$Arguments){& $Program @Arguments;if($LASTEXITCODE -ne 0){throw "Falha ao executar $([IO.Path]::GetFileName($Program))."}}
$installNode=Join-Path $installRuntime 'node\node.exe'
if(-not(Test-Path -LiteralPath $installNode)){
 Write-Output 'Baixando Node.js oficial para esta instalação...'
 $installZip=Join-Path $installRuntime 'node-v24.18.0-win-x64.zip'
 Invoke-WebRequest 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip' -OutFile $installZip -UseBasicParsing
 if((Get-FileHash -LiteralPath $installZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'){throw 'O download do Node não passou na conferência de integridade.'}
 Expand-Archive -LiteralPath $installZip -DestinationPath $installRuntime -Force
 $installExpanded=[IO.Path]::GetFullPath((Join-Path $installRuntime 'node-v24.18.0-win-x64'))
 $installNodeFolder=[IO.Path]::GetFullPath((Join-Path $installRuntime 'node'))
 if(-not $installExpanded.StartsWith($installRuntime+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $installNodeFolder.StartsWith($installRuntime+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Destino de runtime inválido.'}
 if(Test-Path -LiteralPath $installNodeFolder){throw 'Uma instalação parcial do Node já existe. Preserve a pasta e escolha um destino novo.'}
 Move-Item -LiteralPath $installExpanded -Destination $installNodeFolder
}
$env:PATH=(Split-Path -Parent $installNode)+';'+$env:PATH
$installNpm=Join-Path (Split-Path -Parent $installNode) 'npm.cmd'
Push-Location $installRoot
try{
 if(-not(Test-Path -LiteralPath 'node_modules\ws\package.json')){Write-Output 'Instalando dependências verificadas pelo package-lock...';Checked-Run $installNpm @('ci','--omit=dev','--no-audit','--no-fund')}
 Checked-Run $installNode @('scripts\initialize.mjs','--profile',$ProfilePath)
 $installCodexRoot=Join-Path $installRuntime 'codex'
 $installCodex=@(Get-ChildItem -LiteralPath $installCodexRoot -Filter 'codex.exe' -Recurse -ErrorAction SilentlyContinue|Where-Object{$_.FullName -notmatch 'sandbox'})|Select-Object -First 1
 if(-not $installCodex){Write-Output 'Instalando Codex para conectar a conta da própria pessoa...';Checked-Run $installNpm @('install','--prefix',$installCodexRoot,'@openai/codex','--no-audit','--no-fund');$installCodex=Get-ChildItem -LiteralPath $installCodexRoot -Filter 'codex.exe' -Recurse|Where-Object{$_.FullName -notmatch 'sandbox'}|Select-Object -First 1}
 if(-not $installCodex){throw 'Executável do Codex não localizado.'}
 @{node=$installNode;codex=$installCodex.FullName}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $installRoot '.local\runtime-paths.json') -Encoding UTF8
 if($Microphone){
  $installPython=Join-Path $installRuntime 'python\python.exe'
  if(-not(Test-Path -LiteralPath $installPython)){
   $installPythonCandidates=@((Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'))
   $installPythonCommand=Get-Command python.exe -ErrorAction SilentlyContinue
   if($installPythonCommand -and $installPythonCommand.Source -notlike '*\WindowsApps\*'){$installPythonCandidates+=$installPythonCommand.Source}
   foreach($installCandidate in $installPythonCandidates){
    if(Test-Path -LiteralPath $installCandidate){
     & $installCandidate -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,14) else 1)' 2>$null
     if($LASTEXITCODE -eq 0){$installPython=$installCandidate;break}
    }
   }
  }
  if(-not(Test-Path -LiteralPath $installPython)){
   Write-Output 'Preparando Python oficial para reconhecimento local...'
   $installPythonSetup=Join-Path $installRuntime 'python-3.12.10-amd64.exe'
   Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile $installPythonSetup -UseBasicParsing
   $installSignature=Get-AuthenticodeSignature -LiteralPath $installPythonSetup
   if($installSignature.Status -ne 'Valid' -or $installSignature.SignerCertificate.Subject -notmatch 'Python Software Foundation'){throw 'A assinatura do instalador Python não foi validada.'}
   $installPythonResult=Start-Process -FilePath $installPythonSetup -ArgumentList @('/quiet','InstallAllUsers=0','PrependPath=0','Include_test=0',('TargetDir="'+(Join-Path $installRuntime 'python')+'"')) -WindowStyle Hidden -Wait -PassThru
   if($installPythonResult.ExitCode -notin @(0,3010)){throw 'Falha na instalação do Python.'}
   if($installPythonResult.ExitCode -eq 3010){Write-Output 'O instalador informou que o Windows pode precisar ser reiniciado posteriormente. Nenhum reinício será feito.'}
  }
  if(-not(Test-Path -LiteralPath '.venv\Scripts\python.exe')){Checked-Run $installPython @('-m','venv','.venv')}
  Write-Output 'Instalando reconhecimento de fala e ferramentas de documentos...'
  Checked-Run '.venv\Scripts\python.exe' @('-m','pip','install','--disable-pip-version-check','-r','installer\requirements.txt')
  Checked-Run '.venv\Scripts\python.exe' @('scripts\setup-recognition.py')
 }
 $installWebView=@('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')|Where-Object{Test-Path $_}
 if(-not $installWebView){
  Write-Output 'Verificando Microsoft WebView2...'
  $installWebViewSetup=Join-Path $installRuntime 'MicrosoftEdgeWebView2Setup.exe'
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installWebViewSetup -UseBasicParsing
  $installSignature=Get-AuthenticodeSignature -LiteralPath $installWebViewSetup
  if($installSignature.Status -ne 'Valid' -or $installSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'A assinatura Microsoft não foi validada.'}
  $installWebViewResult=Start-Process -FilePath $installWebViewSetup -ArgumentList '/silent /install' -WindowStyle Hidden -Wait -PassThru
  if($installWebViewResult.ExitCode -ne 0){Write-Output 'WebView2 pode já estar presente. O diagnóstico do aplicativo mostrará se ele precisar de reparo.'}
 }
 Write-Output 'Criando atalhos pessoais...'
 $installShell=New-Object -ComObject WScript.Shell
 $installShortcut=$installShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jarvis Community.lnk'))
 $installShortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $installShortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $installRoot 'scripts\Start-Jarvis.ps1')+'"'
 $installShortcut.WorkingDirectory=$installRoot;$installShortcut.WindowStyle=7;$installShortcut.IconLocation=(Join-Path $installRoot 'public\favicon.ico');$installShortcut.Save()
 Write-Output 'Instalação concluída. Conecte sua conta ChatGPT e abra o Jarvis.'
}finally{Pop-Location}
