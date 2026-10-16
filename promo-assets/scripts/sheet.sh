#!/bin/zsh
# usage: scripts-sheet.sh clip.mp4 out.png  -> 4 frames across the clip
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
for i in 0 1 2 3; do t=$(echo "$d*$i/3.2" | bc -l); ffmpeg -v error -ss $t -i "$1" -frames:v 1 -vf scale=640:-1 ${TMPDIR:-/tmp}/sheet-$i.png -y; done
ffmpeg -v error -i ${TMPDIR:-/tmp}/sheet-0.png -i ${TMPDIR:-/tmp}/sheet-1.png -i ${TMPDIR:-/tmp}/sheet-2.png -i ${TMPDIR:-/tmp}/sheet-3.png -filter_complex "[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack" "$2" -y
