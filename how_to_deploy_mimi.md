# Deploying mimi (CapRover)

Production lives on branch **`caprover-deploy`** (`SITE_PATH` empty, site at URL root). GitHub Pages uses branch **`docs`** from `main` with `SITE_PATH=/mimi`, a different host.

**Flow:**
- rebuild Hakyll (`npm run rebuild`)
- stage output in `deploy/site/` (`cp docs deploy/site`)
- commit + push to `caprover-deploy`
- `tar -cf <desired-tar-path> captain-definition deploy/Dockerfile.static deploy/nginx.conf deploy/site`
- `caprover deploy -t <desired-tar-path>`
