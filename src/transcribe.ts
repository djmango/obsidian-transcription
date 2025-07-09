import { TranscriptionSettings, DEFAULT_SETTINGS } from "src/settings";
import { requestUrl, RequestUrlParam, TFile, Vault, App } from "obsidian";
import { format } from "date-fns";
import { PayloadData, payloadGenerator, preprocessWhisperASRResponse } from "src/utils";
import { StatusBar } from "./status";
import { WhisperASRResponse, WhisperASRSegment } from "./types/whisper-asr";
import { TranscribableFileSource } from "./types/external-file";

type TranscriptionBackend = (_file: TFile | TranscribableFileSource) => Promise<string>;


export class TranscriptionEngine {
    settings: TranscriptionSettings;
    vault: Vault;
    statusBar: StatusBar | null;
    app: App;

    transcriptionEngine: TranscriptionBackend;

    transcription_engines: { [key: string]: TranscriptionBackend } = {
        whisper_asr: this.getTranscriptionWhisperASR,
    };

    constructor(
        settings: TranscriptionSettings,
        vault: Vault,
        statusBar: StatusBar | null,
        app: App
    ) {
        this.settings = settings;
        this.vault = vault;
        this.statusBar = statusBar;
        this.app = app;
    }

    segmentsToTimestampedString(
        segments: {start: number, end: number, text: string}[],
        timestampFormat: string,
        interval: number = 0 // in seconds, default is 0 which means no interval adjustment
    ): string {
        let maxDuration = 0;

        // Find the largest timestamp in the segments
        segments.forEach(segment => {
            maxDuration = Math.max(maxDuration, segment.end);
        });

        // Decide format based on maxDuration
        const autoFormat = maxDuration < 3600 ? "mm:ss" : "HH:mm:ss";

        const renderSegments = (segments: {start: number, end: number, text: string}[]) => (
            segments.reduce((transcription: string, segment ) => {
                let start = new Date(segment.start * 1000);
                let end = new Date(segment.end * 1000);
                start = new Date(start.getTime() + start.getTimezoneOffset() * 60000);
                end = new Date(end.getTime() + end.getTimezoneOffset() * 60000);
                const formatToUse = timestampFormat === 'auto' ? autoFormat : timestampFormat;
                const start_formatted = format(start, formatToUse);
                const end_formatted = format(end, formatToUse);
                const segment_string = `${start_formatted} - ${end_formatted}: ${segment.text.trim()}\n`;
                transcription += segment_string;
                return transcription;
            }, ""));

        if (interval > 0) {
            // Group segments based on interval
            const groupedSegments: Record<string, { start: number, end: number, texts: string[] }> = {};
            segments.forEach(segment => {
                // Determine which interval the segment's start time falls into
                const intervalStart = Math.floor(segment.start / interval) * interval;
                if (!groupedSegments[intervalStart]) {
                    groupedSegments[intervalStart] = {
                        start: segment.start,
                        end: segment.end,
                        texts: [segment.text]
                    };
                } else {
                    groupedSegments[intervalStart].end = Math.max(groupedSegments[intervalStart].end, segment.end);
                    groupedSegments[intervalStart].texts.push(segment.text);
                }
            });

            const bucketedSegments = Object.values(groupedSegments).map(group => ({
                start: group.start,
                end: group.end,
                text: group.texts.join("").trim()
            }));
            return renderSegments(bucketedSegments);
        } else {
            // Default behavior: timestamp each segment individually
            return renderSegments(segments);
        }
    }

    async getTranscription(file: TFile | TranscribableFileSource): Promise<string> {
        if (this.settings.debug)
            console.log(
                `Transcription engine: ${this.settings.transcriptionEngine}`,
            );
        const start = new Date();
        this.transcriptionEngine =
            this.transcription_engines[this.settings.transcriptionEngine];
        return this.transcriptionEngine(file).then((transcription) => {
            if (this.settings.debug)
                console.log(`Transcription: ${transcription}`);
            if (this.settings.debug)
                console.log(
                    `Transcription took ${new Date().getTime() - start.getTime()
                    } ms`,
                );
            return transcription;
        });
    }

    async getTranscriptionWhisperASR(file: TFile | TranscribableFileSource): Promise<string> {
        const payload_data: PayloadData = {};
        
        // Handle different file source types
        let fileData: ArrayBuffer;
        if (file instanceof TFile) {
            fileData = await this.vault.readBinary(file);
        } else {
            fileData = await file.getData();
        }
        
        payload_data["audio_file"] = new Blob([fileData]);
        const [request_body, boundary_string] =
            await payloadGenerator(payload_data);

        let args = "output=json"; // always output json, so we can have the timestamps if we need them
        args += `&word_timestamps=true`; // always output word timestamps, so we can have the timestamps if we need them
        const { translate, encode, vadFilter, language, initialPrompt } = this.settings;
        if (translate) args += `&task=translate`;
        if (encode !== DEFAULT_SETTINGS.encode) args += `&encode=${encode}`;
        if (vadFilter !== DEFAULT_SETTINGS.vadFilter) args += `&vad_filter=${vadFilter}`;
        if (language !== DEFAULT_SETTINGS.language) args += `&language=${language}`;
        if (initialPrompt) args += `&initial_prompt=${initialPrompt}`;

        const urls = this.settings.whisperASRUrls
            .split(";")
            .filter(Boolean); // Remove empty strings

        for (const baseUrl of urls) {
            const url = `${baseUrl}/asr?${args}`;
            console.log("Trying URL:", url);

            const options: RequestUrlParam = {
                method: "POST",
                url: url,
                contentType: `multipart/form-data; boundary=----${boundary_string}`,
                body: request_body,
            };

            console.log("Options:", options);

            try {
                const response = await requestUrl(options);
                if (this.settings.debug) console.log("Raw response:", response);

                // ASR_ENGINE=faster_whisper returns segments as an array. Preprocess it to match the standard.
                const preprocessed = Array.isArray(response.json.segments[0])
                    ? preprocessWhisperASRResponse(response.json) : response.json as WhisperASRResponse;

                if (this.settings.debug) console.log("Preprocessed response:", preprocessed);

                // Create segments for each word timestamp if word timestamps are available
                const wordSegments = preprocessed.segments
                    .reduce((acc: {start: number, end: number, text: string}[], segment: WhisperASRSegment) => {
                        if (segment.words) {
                            acc.push(...segment.words.map(wordTimestamp => ({
                                start: wordTimestamp.start,
                                end: wordTimestamp.end,
                                text: wordTimestamp.word
                            })));
                        }
                        return acc;
                    }, []);

                if (this.settings.wordTimestamps) {
                    return this.segmentsToTimestampedString(wordSegments, this.settings.timestampFormat);
                } else if (parseInt(this.settings.timestampInterval)) {
                    // Feed the function word segments with the interval
                    return this.segmentsToTimestampedString(wordSegments, this.settings.timestampFormat, parseInt(this.settings.timestampInterval));
                } else if (this.settings.timestamps) {
                    // Use existing segment-to-string functionality if only segment timestamps are needed
                    const segments = preprocessed.segments.map((segment: WhisperASRSegment) => ({
                        start: segment.start,
                        end: segment.end,
                        text: segment.text
                    }));
                    return this.segmentsToTimestampedString(segments, this.settings.timestampFormat);
                } else if (preprocessed.segments) {
                    // Concatenate all segments into a single string if no timestamps are required
                    return preprocessed.segments
                        .map((segment: WhisperASRSegment) => segment.text)
                        .map(s => s.trim())
                        .join("\n");
                } else {
                    // Fallback to full text if no segments are there
                    return preprocessed.text;
                }
            } catch (error) {
                if (this.settings.debug) console.error("Error with URL:", url, error);
                // Don't return or throw yet, try the next URL
            }
        }
        // If all URLs fail, reject the promise with a generic error or the last specific error caught
        return Promise.reject("All Whisper ASR URLs failed");
    }


}

