function Get-JarvisOwnedProcesses {
  param([object[]]$Snapshot, [int]$RootProcessId)
  $ownedNames = @('node.exe','node_repl.exe','codex.exe','python.exe','pythonw.exe','powershell.exe','pwsh.exe','cmd.exe','conhost.exe','uv.exe','uvx.exe')
  $rootInfo = $Snapshot | Where-Object ProcessId -eq $RootProcessId | Select-Object -First 1
  if (-not $rootInfo -or $rootInfo.Name -notin $ownedNames) { throw 'Processo raiz inválido.' }
  $ordered = New-Object 'System.Collections.Generic.List[object]'
  $rejected = New-Object 'System.Collections.Generic.List[object]'
  $visited = New-Object 'System.Collections.Generic.HashSet[int]'
  function Visit-JarvisOwnedProcess([object]$Parent) {
    if (-not $visited.Add([int]$Parent.ProcessId)) { return }
    foreach ($childInfo in $Snapshot | Where-Object ParentProcessId -eq $Parent.ProcessId) {
      $chronologyValid = $childInfo.CreationDate -and $Parent.CreationDate -and ([datetimeoffset]$childInfo.CreationDate).UtcDateTime -ge ([datetimeoffset]$Parent.CreationDate).UtcDateTime
      if ($childInfo.Name -notin $ownedNames -or -not $chronologyValid) {
        $rejected.Add([pscustomobject]@{ProcessId=$childInfo.ProcessId;Name=$childInfo.Name;Reason=if (-not $chronologyValid) {'parent_pid_reused_or_date_unknown'} else {'external_application'}})
        continue
      }
      Visit-JarvisOwnedProcess $childInfo
    }
    $ordered.Add($Parent)
  }
  Visit-JarvisOwnedProcess $rootInfo
  return [pscustomobject]@{Processes=$ordered.ToArray();Skipped=$rejected.ToArray()}
}
