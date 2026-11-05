$ErrorActionPreference = 'Stop'

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop no está instalado o no está disponible en el PATH.'
}

if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    $secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    (Get-Content '.env') -replace '^JWT_SECRET=.*$', "JWT_SECRET=$secret" |
        Set-Content '.env'
    Write-Host 'Se ha creado .env con un JWT_SECRET local.'
}

docker compose up --build -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Servicios iniciados. API Node: http://localhost:4000/api/health'
Write-Host 'Para detenerlos: .\scripts\stop-local.ps1'
