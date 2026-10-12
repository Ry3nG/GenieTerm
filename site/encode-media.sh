#!/bin/sh
# Encodes the film masters (film/out/master, 4K) into the page's web videos: 1080p H.264 with
# fast start. The feature clips are the demonstration parts of each short, without the hook
# card and end card the page replaces with its own text.
set -e
cd "$(dirname "$0")/.."
M=film/out/master
O=site/media
mkdir -p "$O"

enc() { # master output start_seconds duration_seconds
    ffmpeg -v error -y -ss "$3" -t "$4" -i "$M/$1" -vf "scale=1920:1080:flags=lanczos" \
        -c:v libx264 -preset slow -crf 25 -tune animation -pix_fmt yuv420p -profile:v high -movflags +faststart \
        -c:a aac -b:a 128k "$O/$2"
}

enc Overview-4k.mp4 overview.mp4 0 9999
enc ShortAgent-4k.mp4 sessions.mp4 13.3333 25
enc ShortAI-4k.mp4 command-ai.mp4 2.6667 24
enc ShortFiles-4k.mp4 files.mp4 2.6667 17.3333
enc ShortHost-4k.mp4 host.mp4 2.6667 18.6667
ls -l "$O"/*.mp4
