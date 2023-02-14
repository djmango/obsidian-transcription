#!/bin/bash
docker run -p 9000:9000 -e ASR_MODEL=tiny.en onerahmet/openai-whisper-asr-webservice:latest
