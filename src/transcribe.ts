import { TranscriptionSettings } from "src/main";
import { Notice, requestUrl, RequestUrlParam, TFile, Vault } from "obsidian";
import { format } from "date-fns";
import { paths, components } from "./types/gambitengine";
import { payloadGenerator, PayloadData } from "src/utils";
import { StatusBar } from "./status";

// This class is the parent for transcription engines. It takes settings and a file as an input and returns a transcription as a string

type TranscriptionBackend = (file: TFile) => Promise<string>;

export class TranscriptionEngine {
    settings: TranscriptionSettings;
    vault: Vault;
    status_bar: StatusBar | null;

    transcriptionEngine: TranscriptionBackend

    transcription_engines: { [key: string]: TranscriptionBackend } = {
        "scribe": this.getTranscriptionScribe,
        "whisper_asr": this.getTranscriptionWhisperASR
    }

    constructor(settings: TranscriptionSettings, vault: Vault, statusBar: StatusBar | null) {
        this.settings = settings;
        this.vault = vault;
        this.status_bar = statusBar;
    }

    segmentsToTimestampedString(segments: components['schemas']['TimestampedTextSegment'][], timestampFormat: string): string {
        let transcription = '';
        for (const segment of segments) {
            // Start and end are second floats with 2 decimal places
            // Convert to milliseconds and then to a date object
            let start = new Date(segment.start * 1000);
            let end = new Date(segment.end * 1000);

            // Subtract timezone to get UTC
            start = new Date(start.getTime() + start.getTimezoneOffset() * 60000);
            end = new Date(end.getTime() + end.getTimezoneOffset() * 60000);

            // Format the date objects using the timestamp format
            const start_formatted = format(start, timestampFormat);
            const end_formatted = format(end, timestampFormat);

            const segment_string = `${start_formatted} - ${end_formatted}: ${segment.text}\n`;
            transcription += segment_string;
        }
        return transcription;
    }

    /**
     * 
     * @param {TFile} file 
     * @returns {Promise<string>} promise that resolves to a string containing the transcription 
     */
    async getTranscription(file: TFile): Promise<string> {
        if (this.settings.debug) console.log(`Transcription engine: ${this.settings.transcription_engine}`);
        const start = new Date();
        this.transcriptionEngine = this.transcription_engines[this.settings.transcription_engine];
        return this.transcriptionEngine(file).then((transcription) => {
            if (this.settings.debug) console.log(`Transcription: ${transcription}`);
            if (this.settings.debug) console.log(`Transcription took ${new Date().getTime() - start.getTime()} ms`);
            return transcription;
        })
    }

    async getTranscriptionWhisperASR(file: TFile): Promise<string> {
        // Now that we have the form data payload as an array buffer, we can pass it to requestURL
        // We also need to set the content type to multipart/form-data and pass in the Boundary string

        const payload_data: PayloadData = {}
        payload_data['audio_file'] = new Blob([await this.vault.readBinary(file)]);
        const [request_body, boundary_string] = await payloadGenerator(payload_data);
        
        const options: RequestUrlParam = {
            method: 'POST',
            url: `${this.settings.whisperASRUrl}/asr?task=transcribe&language=en&output=json`,
            contentType: `multipart/form-data; boundary=----${boundary_string}`,
            body: request_body
        };

        return requestUrl(options).then(async (response) => {
            if (this.settings.debug) console.log(response);
            // WhisperASR returns a JSON object with a text field containing the transcription and segments field

            // Pull transcription response.json.text
            if (this.settings.timestamps) return this.segmentsToTimestampedString(response.json.segments, this.settings.timestampFormat);
            return response.json.text;

        }).catch((error) => {
            if (this.settings.debug) console.error(error);
            return Promise.reject(error);
        });
    }

    async getTranscriptionScribe(file: TFile): Promise<string> {
        // Declare constants for the Scribe API
        let api_base: string
        if (this.settings.dev) api_base = 'https://dev.api.gambitengine.com'
        else api_base = 'https://api.gambitengine.com'

        const create_transcription_request: RequestUrlParam = {
            method: 'POST',
            url: `${api_base}/v1/scribe/transcriptions`,
            headers: { 'Authorization': `Bearer ${this.settings.scribeToken}` },
            body: JSON.stringify({ 'translate': this.settings.translate }),
        }

        // Create the transcription request, then upload the file to Scribe S3
        const create_transcription_response: paths['/v1/scribe/transcriptions']['post']['responses']['201']['content']['application/json'] = await requestUrl(create_transcription_request).json

        if (this.settings.debug) console.log(create_transcription_response);
        if (this.settings.debug) console.log('Uploading file to Scribe...');
        if (this.settings.verbosity >= 1) {
            if (this.status_bar !== null) this.status_bar.displayMessage('Uploading...', 5000);
            else new Notice('Uploading file to Scribe...', 3000);
        }

        if (create_transcription_response.upload_request === undefined || create_transcription_response.upload_request.url === undefined || create_transcription_response.upload_request.fields === undefined) {
            if (this.settings.debug) console.error('Scribe returned an invalid upload request');
            return Promise.reject('Scribe returned an invalid upload request');
        }

        // Create the form data payload
        const payload_data: PayloadData = {}

        // Add the upload request data for the S3 presigned URL from Scribe
        for (const [key, value] of Object.entries(create_transcription_response.upload_request.fields)) {
            if (typeof key === 'string' && typeof value === 'string') payload_data[key] = value;
            else {
                if (this.settings.debug) console.error('Scribe returned an invalid upload request');
                return Promise.reject('Scribe returned an invalid upload request');
            }
        }

        // Add the media file
        payload_data['file'] = new Blob([await this.vault.readBinary(file)]);

        // Convert the request to an array buffer
        const [request_body, boundary_string] = await payloadGenerator(payload_data);

        const upload_file_request: RequestUrlParam = {
            method: 'POST',
            url: create_transcription_response.upload_request.url,
            contentType: `multipart/form-data; boundary=----${boundary_string}`,
            body: request_body
        }

        // Upload the file to Scribe S3
        await requestUrl(upload_file_request);
        if (this.settings.debug) console.log('File uploaded to Scribe S3');
        if (this.settings.verbosity >= 1) {
            if (this.status_bar !== null) this.status_bar.displayMessage('Uploaded!', 5000);
            else new Notice('File successfully uploaded to Scribe', 3000);
        }

        // Wait for Scribe to finish transcribing the file

        const get_transcription_request: RequestUrlParam = {
            method: 'GET',
            url: `${api_base}/v1/scribe/transcriptions/${create_transcription_response.transcription.transcription_id}`,
            headers: { 'Authorization': `Bearer ${this.settings.scribeToken}` }
        }

        if (this.settings.debug) console.log('Waiting for Scribe to finish transcribing...');

        // Poll Scribe until the transcription is complete
        let tries = 0;
        const max_tries = 200;
        const sleep_time = 3000;

        let last_percent = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            // Get the transcription status
            const transcription: paths['/v1/scribe/transcriptions/{transcription_id}']['get']['responses']['200']['content']['application/json'] = await requestUrl(get_transcription_request).json;
            if (this.settings.debug) console.log(transcription);

            // Show notice of status change if verbosity is high enough
            if (this.settings.verbosity >= 1) {
                if (transcription.status == 'transcribing') {
                    if (transcription.progress !== last_percent && transcription.progress !== undefined) {
                        if (this.settings.verbosity >= 1) {
                            if (this.status_bar !== null) this.status_bar.displayMessage(`${transcription.progress}%`, 10000, true, this.settings.kek_mode);
                            else new Notice(`Scribe transcribing file: ${transcription.progress}%`, 3000);
                        }
                        last_percent = transcription.progress;
                    }
                }
            }

            // If the transcription is complete, return the transcription text
            if (transcription.status == 'transcribed') { // We can also wait for complete, but transcribed is good enough
                if (this.settings.debug) console.log('Scribe finished transcribing');
                if (this.settings.verbosity >= 1) {
                    if (this.status_bar !== null) this.status_bar.displayMessage('100% - Complete!', 3000, true);
                    else new Notice('Scribe finished transcribing', 3000)
                }
            
                if (!transcription.text_segments || !transcription.text) {
                    if (this.settings.debug) console.error('Scribe returned an invalid transcription');
                    return Promise.reject('Scribe returned an invalid transcription');
                }

                if (this.settings.timestamps) return this.segmentsToTimestampedString(transcription.text_segments, this.settings.timestampFormat);
                else return transcription.text;
            }
            else if (tries > max_tries) {
                if (this.settings.debug) console.error('Scribe took too long to transcribe the file');
                return Promise.reject('Scribe took too long to transcribe the file');
            }
            else if (transcription.status == 'failed') {
                if (this.settings.debug) console.error('Scribe failed to transcribe the file');
                return Promise.reject('Scribe failed to transcribe the file');
            }
            else if (transcription.status == 'validation_failed') {
                if (this.settings.debug) console.error('Scribe has detected an invalid file');
                return Promise.reject('Scribe has detected an invalid file');
            }
            // If the transcription is still in progress, wait 3 seconds and try again
            else {
                tries += 1;
                await sleep(sleep_time);
            }
        }
    }
}
