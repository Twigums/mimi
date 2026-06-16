set -euo pipefail
set +H

OSU="/mnt/c/Users/Victor/Desktop/2023 osu!/Songs/beatmap-639147159872716815-こたえて (feat. 初音ミク&鏡音リン&鏡音レン&巡音ルカ&MEIKO&KAITO) [SGmfjVIGUcY]/imie feat. Hatsune Miku NT (Original +) - Answer Me (vekt0r) [asdf].osu"
if [ ! -f "$OSU" ]; then
  echo "OSU file not found: $OSU" >&2
  exit 1
fi

node_modules/.bin/esbuild src/tools/osu2mimi.ts --bundle --platform=node --outfile=/tmp/osu2mimi.js --log-level=silent

{
  printf 'bpm: 130\ntime_unit: ms\nbeats_per_measure: 4\ndifficulty: 4\n\n# kind, time_ms, degrees, x, y\n'
  /home/victor/.nvm/versions/node/v24.16.0/bin/node /tmp/osu2mimi.js "$OSU" | sed '1,4d'
} > src/songs/kotaete/chart-hard.mimi

PATH=/home/victor/.nvm/versions/node/v24.16.0/bin:$PATH stack exec --system-ghc site -- rebuild