import { TranscriptionSettings, SWIFTINK_AUTH_CALLBACK } from "src/settings";
import { Notice, requestUrl, RequestUrlParam, TFile, Vault } from "obsidian";
import { format } from "date-fns";
import { paths, components } from "./types/swiftink";
import { payloadGenerator, PayloadData } from "src/utils";
import { StatusBar } from "./status";
import { SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";

type TranscriptionBackend = (file: TFile) => Promise<string>;

export class TranscriptionEngine {
    settings: TranscriptionSettings;
    vault: Vault;
    status_bar: StatusBar | null;
    supabase: SupabaseClient;

    transcriptionEngine: TranscriptionBackend;

    transcription_engines: { [key: string]: TranscriptionBackend } = {
        swiftink: this.getTranscriptionSwiftink,
        whisper_asr: this.getTranscriptionWhisperASR,
    };

    constructor(
        settings: TranscriptionSettings,
        vault: Vault,
        statusBar: StatusBar | null,
        supabase: SupabaseClient,
    ) {
        this.settings = settings;
        this.vault = vault;
        this.status_bar = statusBar;
        this.supabase = supabase;
    }

    segmentsToTimestampedString(
        segments: components["schemas"]["TimestampedTextSegment"][],
        timestampFormat: string,
    ): string {
        let transcription = "";
        for (const segment of segments) {
            let start = new Date(segment.start * 1000);
            let end = new Date(segment.end * 1000);

            start = new Date(
                start.getTime() + start.getTimezoneOffset() * 60000,
            );
            end = new Date(end.getTime() + end.getTimezoneOffset() * 60000);

            const start_formatted = format(start, timestampFormat);
            const end_formatted = format(end, timestampFormat);

            const segment_string = `${start_formatted} - ${end_formatted}: ${segment.text}\n`;
            transcription += segment_string;
        }
        return transcription;
    }

    async getTranscription(file: TFile): Promise<string> {
        if (this.settings.debug)
            console.log(
                `Transcription engine: ${this.settings.transcription_engine}`,
            );
        const start = new Date();
        this.transcriptionEngine =
            this.transcription_engines[this.settings.transcription_engine];
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

    async getTranscriptionWhisperASR(file: TFile): Promise<string> {
        const payload_data: PayloadData = {};
        payload_data["audio_file"] = new Blob([
            await this.vault.readBinary(file),
        ]);
        const [request_body, boundary_string] =
            await payloadGenerator(payload_data);

        let args = "task=transcribe";
        if (this.settings.language != "auto")
            args += `&language=${this.settings.language}`;

        const url = `${this.settings.whisperASRUrl}/asr?${args}`;
        console.log("URL:", url);

        const options: RequestUrlParam = {
            method: "POST",
            url: url,
            contentType: `multipart/form-data; boundary=----${boundary_string}`,
            body: request_body,
        };
        console.log("Options:", options);

        return requestUrl(options)
            .then(async (response) => {
                if (this.settings.debug) console.log(response);
                if (typeof response.text === "string") return response.text;
                else return response.json.text;
            })
            .catch((error) => {
                if (this.settings.debug) console.error(error);
                return Promise.reject(error);
            });
    }

    async getTranscriptionSwiftink(file: TFile): Promise<string> {
        const api_base = "https://api.swiftink.io";

        const session = await this.supabase.auth.getSession().then((res) => {
            return res.data;
        });

        if (session == null || session.session == null) {
            window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
            return Promise.reject(
                "No user session found. Please log in and try again.",
            );
        }

        const token = session.session.access_token;
        const id = session.session.user.id;

        const fileStream = await this.vault.readBinary(file);
        const filename = file.name.replace(/[^a-zA-Z0-9.]+/g, "-");

        // Declare progress notice for uploading
        let uploadProgressNotice: Notice | null = null;

        const uploadPromise = new Promise<tus.Upload>((resolve) => {
            const upload = new tus.Upload(new Blob([fileStream]), {
                endpoint: `https://auth.swiftink.io/storage/v1/upload/resumable`,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                headers: {
                    authorization: `Bearer ${token}`,
                    "x-upsert": "true",
                },
                uploadDataDuringCreation: true,
                metadata: {
                    bucketName: "swiftink-upload",
                    objectName: `${id}/${filename}`,
                },
                chunkSize: 6 * 1024 * 1024,
                onProgress: (bytesUploaded, bytesTotal) => {
                    const percentage = (
                        (bytesUploaded / bytesTotal) *
                        100
                    ).toFixed(2);

                    // Create a notice message with the progress
                    const noticeMessage = `Uploading: ${percentage}%`;

                    // Check if a notice has already been created
                    if (!uploadProgressNotice) {
                        // If not, create a new notice
                        uploadProgressNotice = new Notice(noticeMessage, 800 * 100);
                    } else {
                        // If the notice exists, update its content
                        uploadProgressNotice.setMessage(noticeMessage);
                        //uploadProgressNotice.hide();
                    }

                    if (this.settings.debug) {
                        console.log(
                            bytesUploaded,
                            bytesTotal,
                            percentage + "%",
                        );
                    }
                },
                onSuccess: () => {
                    if (this.settings.debug) {
                        console.log(
                            `Successfully uploaded ${filename} to Swiftink`,
                        );
                    }

                    // Close the progress notice on successful upload
                    if (uploadProgressNotice) {
                        uploadProgressNotice.hide();
                    }

                    resolve(upload);
                },

            });

            upload.start();
        });

        try {
            await uploadPromise;
            new Notice(`Successfully uploaded ${filename} to Swiftink`);
        } catch (error) {
            if (this.settings.debug) {
                console.log("Failed to upload to Swiftink: ", error);
            }

            return Promise.reject(new Notice(`Failed to upload ${filename} to Swiftink`));
        }

        // Declare progress notice for transcription
        let transcriptionProgressNotice: Notice | null = null;

        const fileUrl = `https://auth.swiftink.io/storage/v1/object/public/swiftink-upload/${id}/${filename}`;
        const url = `${api_base}/transcripts/`;
        const headers = { Authorization: `Bearer ${token}` };
        const body: paths["/transcripts/"]["post"]["requestBody"]["content"]["application/json"] =
        {
            name: filename,
            url: fileUrl,
        };

        if (this.settings.language != "auto")
            body.language = this.settings
                .language as components["schemas"]["CreateTranscriptionRequest"]["language"];

        if (this.settings.debug) console.log(body);

        const options: RequestUrlParam = {
            method: "POST",
            url: url,
            headers: headers,
            body: JSON.stringify(body),
        };

        let transcript_create_res;
        try {
            transcript_create_res = await requestUrl(options);
        } catch (error) {
            if (this.settings.debug)
                console.log("Failed to create transcript: ", error);
            return Promise.reject(error);
        }

        let transcript: components["schemas"]["TranscriptSchema"] =
            transcript_create_res.json;
        if (this.settings.debug) console.log(transcript);

        let completed_statuses = ["transcribed", "complete"];

        if (
            this.settings.embedSummary ||
            this.settings.embedOutline ||
            this.settings.embedKeywords
        ) {
            completed_statuses = ["complete"];
        }

        return new Promise((resolve, reject) => {
            let tries = 0;

            // Function to update the transcription progress notice
            const updateTranscriptionNotice = (percentage: number) => {
                const noticeMessage = `Please wait, Swiftink is Transcribing the file`;
                if (!transcriptionProgressNotice) {
                    transcriptionProgressNotice = new Notice(noticeMessage, 800 * 100);
                } else {
                    transcriptionProgressNotice.setMessage(noticeMessage);

                }
            };

            const poll = setInterval(async () => {
                const options: RequestUrlParam = {
                    method: "GET",
                    url: `${api_base}/transcripts/${transcript.id}`,
                    headers: headers,
                };
                const transcript_res = await requestUrl(options);
                transcript = transcript_res.json;
                if (this.settings.debug) console.log(transcript);

                if (
                    transcript.status &&
                    completed_statuses.includes(transcript.status)
                ) {
                    clearInterval(poll);

                    //Close the transcription progress notice on completion
                    if (transcriptionProgressNotice) {
                        transcriptionProgressNotice.hide();
                    }

                    new Notice(
                        `Successfully transcribed ${filename} with Swiftink`,
                    );
                    resolve(this.formatSwiftinkResults(transcript));
                } else if (transcript.status == "failed") {
                    if (this.settings.debug)
                        console.error(
                            "Swiftink failed to transcribe the file"
                        );
                    clearInterval(poll);
                    reject("Swiftink failed to transcribe the file");
                } else if (transcript.status == "validation_failed") {
                    if (this.settings.debug)
                        console.error(
                            "Swiftink has detected an invalid file"
                        );
                    clearInterval(poll);
                    reject("Swiftink has detected an invalid file");
                } else if (tries > 20) {
                    if (this.settings.debug)
                        console.error(
                            "Swiftink took too long to transcribe the file"
                        );
                    clearInterval(poll);
                    reject(
                        "Swiftink took too long to transcribe the file"
                    );
                } else {
                    // Update the transcription progress notice
                    updateTranscriptionNotice(
                        (tries / 20) * 100
                    );
                }
                tries++;
            }, 3000);
        });
    }

    formatSwiftinkResults(
        transcript: components["schemas"]["TranscriptSchema"]
    ): string {
        let transcript_text = "## Transcript\n";

        if (this.settings.timestamps)
            transcript_text += this.segmentsToTimestampedString(
                transcript.text_segments,
                this.settings.timestampFormat
            );
        else transcript_text += transcript.text ? transcript.text : "";

        if (transcript_text.slice(-1) !== "\n")
            transcript_text += "\n";

        if (
            this.settings.embedSummary &&
            transcript.summary &&
            transcript.summary !==
            "Insufficient information for a summary."
        )
            transcript_text += `## Summary\n${transcript.summary}`;

        if (transcript_text.slice(-1) !== "\n")
            transcript_text += "\n";

        if (
            this.settings.embedOutline &&
            transcript.heading_segments.length > 0
        )
            transcript_text += `## Outline\n${this.segmentsToTimestampedString(
                transcript.heading_segments,
                this.settings.timestampFormat
            )}`;

        if (transcript_text.slice(-1) !== "\n")
            transcript_text += "\n";

        if (
            this.settings.embedKeywords &&
            transcript.keywords.length > 0
        )
            transcript_text += `## Keywords\n${transcript.keywords.join(
                ", "
            )}`;

        if (transcript_text.slice(-1) !== "\n")
            transcript_text += "\n";

        if (this.settings.embedAdditionalFunctionality) {
            transcript_text += `[...](obsidian://swiftink_transcript_functions?id=${transcript.id})`;
        }

        return transcript_text;
    }
}

