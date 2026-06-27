$ErrorActionPreference = "Stop"

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $Dir "../..")).Path
$Lyrics = Join-Path $Dir "hard.lyrics"
$Out = Join-Path $Root "src/songs/kotaete/hard.mimi"
$Osu = 'C:\Users\victo\Desktop\2023 osu!\Songs\imie feat Hatsune Miku NT (Original +) - Answer Me\imie feat. Hatsune Miku NT (Original +) - Answer Me (vekt0r) [asdf2].osu'

Push-Location $Root
try {
    npm run --silent convert:osu -- `
        --bpm 130 `
        --difficulty 4 `
        --lyrics $Lyrics `
        --out $Out `
        $Osu
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

Write-Host "Wrote $Out"
