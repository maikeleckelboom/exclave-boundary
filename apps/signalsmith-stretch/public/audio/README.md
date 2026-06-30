# Demo audio

`signalsmith-demo-loop.wav` is the official Signalsmith Stretch Web Audio demo
`loop.mp3`, fetched from
`https://signalsmith-audio.co.uk/code/stretch/demo/loop.mp3` on 2026-06-29 and
converted to WAV for local comparison testing.

The source MP3 had no embedded title or artist metadata. Identify this asset as
the official Signalsmith demo loop unless upstream publishes a more specific
title.

Conversion command:

```sh
ffmpeg -i loop.mp3 -ar 48000 -ac 2 -c:a pcm_s16le signalsmith-demo-loop.wav
```
