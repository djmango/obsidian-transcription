# Obsidian Transcription

Create high-quality text transcriptions from any media file, on any device using Whisper ASR. Best-in-class speech-to-text via [OpenAI Whisper](https://openai.com/blog/whisper/).

![Demo](media/demo.gif)

## Features

-   Wide range of audio and video file formats supported via [ffmpeg](https://ffmpeg.org/)
-   Local transcription engine using [Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice) - open-source
-   Start and end timestamps for each line of the transcription
-   Transcribe multiple files at once
-   Transcribe files in the background
-   Multiple language support with automatic language detection
-   Customizable timestamp formats and intervals
-   Translation support for non-English audio

## Prerequisites

Before you can use this plugin, you'll need to have **Docker** installed and running on your system. Docker is required to run the Whisper ASR transcription service locally.

### Installing Docker

1. **Windows/Mac**: Download and install Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop/)
2. **Linux**: Install Docker Engine following the instructions for your distribution at [docs.docker.com](https://docs.docker.com/engine/install/)

Make sure Docker is running before proceeding to the next steps.

## Installation and Setup

### Step 1: Install the Plugin

1. Open Obsidian
2. Go to Settings → Community plugins
3. Turn off Safe mode if it's enabled
4. Click "Browse" and search for "Transcription"
5. Install the plugin and enable it

### Step 2: Set Up the Whisper ASR Service

The plugin requires a local Whisper ASR service to be running. You have two options:

#### Option A: Using the provided script (Recommended)

1. Open a terminal/command prompt
2. Navigate to your plugin folder or download the script
3. Run the startup script:
   ```bash
   ./scripts/start-whisper-asr.sh
   ```

#### Option B: Manual Docker setup

1. Open a terminal/command prompt
2. Run the following Docker command:
   ```bash
   docker run -d -p 9000:9000 -e ASR_MODEL=base -e ASR_ENGINE=openai_whisper onerahmet/openai-whisper-asr-webservice:latest
   ```

**Important Notes:**
- The Docker service needs to be running **each time you want to use the plugin**
- After restarting your computer, you'll need to start the Docker service again
- The service will run in the background until you stop it or restart your computer

### Step 3: Verify Setup

1. Check that Docker is running the service:
   ```bash
   docker ps
   ```
   You should see a container with the name containing "openai-whisper-asr-webservice"

2. Test the service by visiting `http://localhost:9000` in your browser - you should see the Whisper ASR interface

## How to Use

### Basic Usage

1. **Ensure Docker service is running** (see Step 2 above)
2. In Obsidian, right-click on any audio or video file in your vault
3. Select "Transcribe" from the context menu
4. The transcription will appear in a new note or be inserted into the current note

### Supported File Formats

The plugin supports a wide variety of audio and video formats:
- **Audio**: MP3, WAV, WEBM, OGG, FLAC, M4A, AAC, AMR, OPUS, AIFF, M3GP
- **Video**: MP4, AVI, MOV, MKV, and other common video formats

### Plugin Settings

Access the plugin settings through Settings → Community plugins → Transcription:

- **Timestamps**: Enable/disable timestamps in transcriptions
- **Timestamp Format**: Choose between different timestamp formats
- **Language**: Set a specific language or use auto-detection
- **Translation**: Enable to translate non-English audio to English
- **Whisper ASR URL**: Change if running the service on a different port (default: `http://localhost:9000`)

### Advanced Features

#### Batch Transcription
- Select multiple media files and transcribe them all at once
- Files are processed in the background, so you can continue working

#### Custom Prompts
- Set initial prompts to improve transcription accuracy for specific content types
- Useful for technical content, names, or specialized terminology

## Troubleshooting

### Common Issues

**"Connection failed" or "Service unavailable"**
1. Ensure Docker is running: `docker ps`
2. If no containers are running, restart the Whisper ASR service (see Step 2)
3. Check if port 9000 is available: `lsof -i :9000` (Mac/Linux) or `netstat -an | findstr :9000` (Windows)

**"Transcription failed"**
1. Check if your audio file is not corrupted
2. Try with a different audio format
3. Ensure the file is not too large (recommended: under 100MB)

**Docker container won't start**
1. Make sure Docker Desktop is running
2. Check available disk space
3. Try pulling the image manually: `docker pull onerahmet/openai-whisper-asr-webservice:latest`

### Performance Tips

- **Model Selection**: The default model (`base`) provides a good balance of speed and accuracy
  - For faster processing: Use `tiny` or `tiny.en` models
  - For better accuracy: Use `small`, `medium`, or `large` models
- **Hardware**: GPU acceleration is supported if you have NVIDIA GPU with Docker GPU support
- **File Size**: For large files, consider splitting them into smaller chunks for better performance

### Getting Help

If you encounter issues:
1. Check the Docker logs: `docker logs [container-name]`
2. Enable debug mode in plugin settings for more detailed error messages
3. Create an issue on the [GitHub repository](https://github.com/djmango/obsidian-transcription/issues)

## Video Tutorial

For a visual walkthrough of the installation and setup process:

[![Tutorial](https://img.youtube.com/vi/EyfhLGF3Fxg/0.jpg)](https://www.youtube.com/watch?v=EyfhLGF3Fxg)

## Contact

Contact me on Twitter [@sulaimanghori](https://twitter.com/sulaimanghori) if you have any comments, issues, or suggestions!

## Credits

-   [Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice) by Ahmed, for the easy-to-use Whisper webservice backend
-   [OpenAI Whisper](https://openai.com/blog/whisper/) for the underlying speech recognition technology
