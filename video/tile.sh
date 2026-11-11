#!/bin/bash
# tile.sh <dir> <out.jpg> [cols] [scalew] : tile every png/jpg in dir
d=$1; n=$(ls $d | wc -l); cols=${3:-2}; rows=$(( (n + cols - 1) / cols ))
ffmpeg -v error -y -framerate 1 -pattern_type glob -i "$d/*.png" -vf "scale=${4:-960}:-1,tile=${cols}x${rows}" -frames:v 1 -q:v 2 "$2"
