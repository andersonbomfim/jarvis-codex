$ErrorActionPreference='Stop'
$stopRoot=Split-Path -Parent $PSScriptRoot
$stopMarker=Join-Path $stopRoot 'scripts\launch-community.mjs'
$stopProcesses=@(Get-CimInstance Win32_Process)
$stopOwned=@($stopProcesses|Where-Object{$_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($stopMarker)})
foreach($stopOwner in $stopOwned){
 $stopIds=[Collections.Generic.HashSet[int]]::new();[void]$stopIds.Add([int]$stopOwner.ProcessId)
 do{$stopAdded=$false;foreach($stopProcess in $stopProcesses){if($stopIds.Contains([int]$stopProcess.ParentProcessId) -and $stopIds.Add([int]$stopProcess.ProcessId)){$stopAdded=$true}}}while($stopAdded)
 foreach($stopId in @($stopIds|Where-Object{$_ -ne $stopOwner.ProcessId})){Stop-Process -Id $stopId -ErrorAction SilentlyContinue}
 Stop-Process -Id $stopOwner.ProcessId -ErrorAction SilentlyContinue
}
Write-Output 'Somente os serviços desta instalação foram encerrados.'
