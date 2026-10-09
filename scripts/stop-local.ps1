$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot 'storage\local-postgres-data'
$pgBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
if (-not (Test-Path (Join-Path $dataPath 'PG_VERSION'))) { throw 'No NoteKart local database was found.' }
& (Join-Path $pgBin 'pg_ctl.exe') -D $dataPath -m fast stop
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the local database. Check its status and log.' }
