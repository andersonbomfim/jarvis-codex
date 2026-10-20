$ErrorActionPreference='Stop'
$connectionRoot=Split-Path -Parent $PSScriptRoot
$connectionRuntime=Get-Content -LiteralPath (Join-Path $connectionRoot '.local\runtime-paths.json') -Raw|ConvertFrom-Json
& $connectionRuntime.codex login
if($LASTEXITCODE -ne 0){throw 'O login não foi concluído. Tente novamente; nenhuma credencial de outra pessoa foi usada.'}
