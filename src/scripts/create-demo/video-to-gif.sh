#!/bin/sh
# Taken from
# http://blog.pkh.me/p/21-high-quality-gif-with-ffmpeg.html
# Also archived here:
# https://web.archive.org/web/20190717212535/http://blog.pkh.me/p/21-high-quality-gif-with-ffmpeg.html

palette="/tmp/palette.png"

filters="fps=15,scale=640:-1:flags=bicubic"

ffmpeg -v warning -i "$1" -vf "${filters},palettegen" -y "${palette}"
ffmpeg -v warning -i "$1" -i ${palette} -lavfi "${filters} [x]; [x][1:v] paletteuse" -y "$2"
