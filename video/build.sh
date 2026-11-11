#!/bin/bash
# Renders the composited frames and encodes video/kiloton-explainer.mp4 (+ poster). Run capture first: node clips.mjs city collapse pilot bay gas boss
set -e
cd "$(dirname "$0")"
OUT=${1:-out}
node render.mjs --out "$OUT" | tee work/render.log
N=$(grep -o 'total frames [0-9]*' work/render.log | grep -o '[0-9]*$')
# H.264 High, yuv420p, 30 fps, silent stereo AAC track (the video has no sound), faststart for web upload
ffmpeg -v error -stats -y -framerate 30 -i "work/$OUT/%05d.png" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -frames:v "$N" -c:v libx264 -preset slow -profile:v high -level 4.0 -crf 19 -maxrate 5500k -bufsize 11000k -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -vf "scale=out_color_matrix=bt709:out_range=tv" -r 30 -g 60 \
  -c:a aac -b:a 64k -shortest -movflags +faststart kiloton-explainer.mp4
P=$(grep -o '"id":"collapse","start":[0-9]*' work/render.log | grep -o '[0-9]*$')
ffmpeg -v error -y -i "work/$OUT/$(printf %05d $((P + 88))).png" -q:v 2 kiloton-explainer.jpg
ffprobe -v error -show_entries stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,nb_frames -show_entries format=duration,size,bit_rate -of default=nw=1 kiloton-explainer.mp4
