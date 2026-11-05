$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
& "$PSScriptRoot\start-local.ps1"

Set-Location "$root\client"
@'
VITE_API_URL=http://10.0.2.2:4000
'@ | Set-Content '.env'

npm run android:sync
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx cap open android
