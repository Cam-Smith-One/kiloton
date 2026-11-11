#!/bin/bash
# sheet.sh <dir-or-video> <out.jpg> [cols] [step]  : contact sheet for eyeballing
in=$1; out=$2; cols=${3:-4}; step=${4:-1}
if [ -d "$in" ]; then ffmpeg -v error -y -framerate 1 -pattern_type glob -i "$in/*.jpg" -vf "select='not(mod(n,$step))',scale=480:-1,tile=${cols}x${5:-5}" -frames:v 1 -q:v 3 "$out"
else ffmpeg -v error -y -i "$in" -vf "fps=1/$step,scale=320:-1,tile=${cols}x${5:-6}" -frames:v 1 -q:v 3 "$out"; fi
