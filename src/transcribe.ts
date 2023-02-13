import { TranscriptionSettings } from "src/main";
import { Notice, requestUrl, RequestUrlParam, TFile, Vault } from "obsidian";
import { paths, components } from "./types/gambitengine";
import { payloadGenerator, PayloadData } from "src/utils";

// This class is the parent for transcription engines. It takes settings and a file as an input and returns a transcription as a string

type TranscriptionBackend = (file: TFile) => Promise<string>;

export class TranscriptionEngine {
    settings: TranscriptionSettings;
    vault: Vault;
    transcription_engine: TranscriptionBackend

    transcription_engines: { [key: string]: TranscriptionBackend } = {
        "scribe": this.getTranscriptionScribe,
        "whisper_asr": this.getTranscriptionWhisperASR
    }

    constructor(settings: TranscriptionSettings, vault: Vault) {
        this.settings = settings;
        this.vault = vault;
    }

    segmentsToTimestampedString(segments: components['schemas']['TranscriptionResultSegment'][]): string {
        let transcription = "";
        const duration_seconds = Math.floor(segments[segments.length - 1].end);
        let start_iso_slice = 14;
        if (duration_seconds >= 3600) start_iso_slice = 11;
        for (const s of segments) {
            if (typeof s.start === 'number' && typeof s.text === 'string') {
                // Convert the start and end times to ISO 8601 format and then substring to get the HH:MM:SS portion
                const start = new Date(Math.floor(s.start) * 1000).toISOString().substring(start_iso_slice, 19)
                const end = new Date(Math.floor(s.end) * 1000).toISOString().substring(start_iso_slice, 19)
                const timestamp = `\`[${start} - ${end}]\``
                // Add the timestamp and the text to the transcription
                transcription += timestamp + ': ' + s.text + "\n"
            }
            else {
                if (this.settings.debug) console.error(`Invalid segment: ${s}`)
            }
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
        this.transcription_engine = this.transcription_engines[this.settings.transcription_engine];
        return this.transcription_engine(file).then((transcription) => {
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
            url: `${this.settings.whisperASRUrl}/asr?task=transcribe&language=en`,
            contentType: `multipart/form-data; boundary=----${boundary_string}`,
            body: request_body
        };

        return requestUrl(options).then(async (response) => {
            if (this.settings.debug) console.log(response);

            // WhisperASR returns a JSON object with a text field containing the transcription and segments field
            if (this.settings.timestamps) return this.segmentsToTimestampedString(response.json.segments);
            else {
                const transcription: string = response.json.text;
                return transcription;
            }
        }).catch((error) => {
            if (this.settings.debug) console.error(error);
            return Promise.reject(error);
        });
    }

    async getTranscriptionScribe(file: TFile): Promise<string> {
        // Declare constants for the Scribe API
        let api_base: string
        if (this.settings.debug) api_base = 'https://dev.api.gambitengine.com'
        else api_base = 'https://api.gambitengine.com'

        const create_transcription_request: RequestUrlParam = {
            method: 'POST',
            url: `${api_base}/v1/scribe/transcriptions`,
            headers: { 'Authorization': `Bearer ${this.settings.scribeToken}` },
            body: JSON.stringify({ 'translate': this.settings.translate }),
        }
        console.log(this.settings.translate);

        if (this.settings.debug) console.log("Transcribing with Scribe");
        // Create the transcription request, then upload the file to Scribe S3
        const create_transcription_response: paths['/v1/scribe/transcriptions']['post']['responses']['201']['content']['application/json'] = await requestUrl(create_transcription_request).json

        if (this.settings.debug) console.log(create_transcription_response);
        if (this.settings.debug) console.log('Uploading file to Scribe S3...');
        if (this.settings.verbosity >= 1) new Notice('Uploading file to Scribe S3...', 2500);

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
        if (this.settings.verbosity >= 1) new Notice('File successfully uploaded to Scribe', 2500);

        // Wait for Scribe to finish transcribing the file

        const get_transcription_request: RequestUrlParam = {
            method: 'GET',
            url: `${api_base}/v1/scribe/transcriptions/${create_transcription_response.transcription.transcription_id}`,
            headers: { 'Authorization': `Bearer ${this.settings.scribeToken}` }
        }

        if (this.settings.debug) console.log('Waiting for Scribe to finish transcribing...');

        // Poll Scribe until the transcription is complete
        let tries = 0;
        const max_tries = 100;
        const sleep_time = 3000;

        let transcribing_notice: Notice | undefined;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            // Get the transcription status
            const transcription: paths['/v1/scribe/transcriptions/{transcription_id}']['get']['responses']['200']['content']['application/json'] = await requestUrl(get_transcription_request).json;
            if (this.settings.debug) console.log(transcription);

            // Show notice of status change if verbosity is high enough
            if (this.settings.verbosity >= 1) {
                if (transcription.status == 'transcribing') {
                    if (transcribing_notice === undefined && transcription.transcription_progress !== undefined) { transcribing_notice = new Notice(`Scribe transcribing file: ${transcription.transcription_progress * 100}%`, max_tries*sleep_time); }

                    else if (transcription.transcription_progress !== undefined) {
                        transcribing_notice?.setMessage(`Scribe transcribing file: ${transcription.transcription_progress * 100}%`)
                    }
                }
            }

            // If the transcription is complete, return the transcription text
            if (transcription.status == 'complete' &&
                transcription.transcription_text !== undefined &&
                transcription.transcription_result !== undefined) {
                // Idk how asserts work in JS, but this should be an assert

                if (transcribing_notice !== undefined) transcribing_notice.hide();
                if (this.settings.debug) console.log('Scribe finished transcribing');
                if (this.settings.verbosity >= 1) new Notice('Scribe finished transcribing', 2500)

                if (this.settings.timestamps) return this.segmentsToTimestampedString(transcription.transcription_result);
                else return transcription.transcription_text;
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
