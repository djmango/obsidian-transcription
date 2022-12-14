# Obsidian Transcription

A plugin to generate super-fast high-quality transcriptions of audio and video files via the new open-source [OpenAI Whisper model](https://openai.com/blog/whisper/)

![Demo](images/demo.gif)

## Features

- Wide range of audio and video file formats supported via [ffmpeg](https://ffmpeg.org/)
- Flexible transcription engines - local or cloud
  - [Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice)
  - [Whisper via Huggingface](https://huggingface.co/openai/whisper-large) (coming soon)
  - [GambitEngine Scribe](https://gambitengine.com/) (coming soon)
- Customizable output format (coming soon)

## How to use

1. Install the plugin
2. Set up [Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice) or [GambitEngine Scribe](https://gambitengine.com/) (coming soon)
3. If not hosting locally, configure the URL of the transcription engine in the settings

## Credits

- [Obsidian Shell Commands](https://github.com/Taitava/obsidian-shellcommands) by Taitava, for utility functions and shell command execution
- [Obsidian OCR](https://github.com/MohrJonas/obsidian-ocr/) by Jonas Mohr, for the idea of using shell commands to augment Obsidian's file functionality.
