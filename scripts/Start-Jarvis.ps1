param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$communityRoot=Split-Path -Parent $PSScriptRoot
$communityLocal=Join-Path $communityRoot '.local'
$communityRuntimePath=Join-Path $communityLocal 'runtime-paths.json'
if(Test-Path -LiteralPath $communityRuntimePath){$communityRuntime=Get-Content -LiteralPath $communityRuntimePath -Raw|ConvertFrom-Json;$communityNode=$communityRuntime.node;$env:JARVIS_CODEX_PATH=$communityRuntime.codex}else{$communityNode=(Get-Command node.exe -ErrorAction Stop).Source}
$env:PATH=(Split-Path -Parent $communityNode)+';'+$env:PATH
$communityReady=$false
try{$communityHealth=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2;if($communityHealth.application -ne 'jarvis-codex-community'){throw 'OTHER_JARVIS'};$communityReady=$true}catch{if($_.Exception.Message -eq 'OTHER_JARVIS'){throw 'Outra instalação do Jarvis está usando as portas locais. Feche os serviços dela antes de abrir esta cópia.'}}
if(-not $communityReady){
 & $communityNode (Join-Path $PSScriptRoot 'initialize.mjs')|Out-Null
 $communityProcess=Start-Process -FilePath $communityNode -ArgumentList ('"'+(Join-Path $PSScriptRoot 'launch-community.mjs')+'"') -WorkingDirectory $communityRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $communityLocal 'runtime.log') -RedirectStandardError (Join-Path $communityLocal 'runtime-error.log')
 @{pid=$communityProcess.Id;root=$communityRoot}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $communityLocal 'runtime.json') -Encoding UTF8
 for($communityAttempt=0;$communityAttempt -lt 40;$communityAttempt++){try{$communityHealth=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 1;if($communityHealth.application -eq 'jarvis-codex-community'){$communityReady=$true;break}}catch{};Start-Sleep -Milliseconds 500}
 if(-not $communityReady){throw ('Jarvis não iniciou. Consulte '+(Join-Path $communityLocal 'runtime-error.log'))}
}
if(-not $NoOpen){Start-Process -FilePath (Join-Path $communityLocal 'desktop\app\Jarvis.exe') -WorkingDirectory $communityRoot}
