#!/bin/zsh
# usage: review.sh out.png clip1.mp4 clip2.mp4 ...   one row per clip, 4 frames each
out=$1; shift
T=$(mktemp -d); rows=()
i=0
for c in "$@"; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$c")
  for k in 0 1 2 3; do t=$(echo "$d*$k/4.2" | bc -l); ffmpeg -v error -ss $t -i "$c" -frames:v 1 -vf scale=420:-2 $T/$i-$k.png -y; done
  ffmpeg -v error -i $T/$i-0.png -i $T/$i-1.png -i $T/$i-2.png -i $T/$i-3.png -filter_complex "hstack=4" $T/row$i.png -y
  rows+=(-i $T/row$i.png); i=$((i+1))
done
ffmpeg -v error "${rows[@]}" -filter_complex "vstack=$i" "$out" -y
