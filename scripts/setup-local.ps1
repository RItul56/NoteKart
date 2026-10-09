$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
$dataPath = Join-Path $projectRoot 'storage\local-postgres-data'
$pgBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
function New-RandomHex([int]$length) {
  $bytes = New-Object byte[] $length
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  ([BitConverter]::ToString($bytes)).Replace('-','')
}

if (Test-Path $envPath) { throw '.env already exists. Keep your current database configuration; this setup will not overwrite it.' }
foreach ($tool in @('initdb.exe','pg_ctl.exe','createdb.exe','psql.exe')) {
  if (-not (Test-Path (Join-Path $pgBin $tool))) { throw "PostgreSQL tool missing: $pgBin\$tool. Set POSTGRES_BIN to the folder containing PostgreSQL tools." }
}
if (Test-Path $dataPath) { throw "Local database data already exists at $dataPath. Keep it and configure .env manually, or back it up before removing it." }

$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dataPath)
$password = New-RandomHex 32
$sessionSecret = New-RandomHex 48
$passwordFile = Join-Path (Split-Path -Parent $dataPath) 'local-pg-password.tmp'
try {
  [IO.File]::WriteAllText($passwordFile, $password)
  & (Join-Path $pgBin 'initdb.exe') -D $dataPath -U notekart -A scram-sha-256 --pwfile $passwordFile --encoding=UTF8
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
} finally {
  Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
}

$envText = @"
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://notekart:$password@127.0.0.1:55432/notekart
SESSION_SECRET=$sessionSecret
APP_ORIGIN=http://localhost:3000
# Set SMTP_PASSWORD to the sender account's SMTP credential to enable email.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=ritulmastkar56@gmail.com
SMTP_PASSWORD=
NOTEKART_EMAIL=ritulmastkar56@gmail.com
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
MAX_UPLOAD_MB=15
"@
[IO.File]::WriteAllText($envPath, $envText.Trim() + [Environment]::NewLine)

$logPath = Join-Path (Split-Path -Parent $dataPath) 'local-postgres.log'
& (Join-Path $pgBin 'pg_ctl.exe') -D $dataPath -o '-h 127.0.0.1 -p 55432' -l $logPath start
if ($LASTEXITCODE -ne 0) { throw 'Could not start the local PostgreSQL instance. Check storage/local-postgres.log.' }

$env:PGPASSWORD = $password
try {
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U notekart -O notekart notekart
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the NoteKart database.' }
  & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U notekart -d notekart -v ON_ERROR_STOP=1 -f (Join-Path $projectRoot 'database\schema.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Could not apply database/schema.sql.' }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Output 'Local NoteKart database is ready on 127.0.0.1:55432.'
Write-Output 'Start the website with npm start, then open http://localhost:3000.'
Write-Output 'Passwords and local database data are kept in ignored local files.'
