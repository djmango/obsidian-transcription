import { TranscriptionSettings } from "src/main";
import { requestUrl, RequestUrlParam, TFile, Vault } from "obsidian";
import { paths } from "./types/gambitengine";
import { fileToRequestPayload, payloadGenerator, PayloadData } from "src/utils";

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

    /**
     * 
     * @param {TFile} file 
     * @returns {Promise<string>} promise that resolves to a string containing the transcription 
     */
    async getTranscription(file: TFile): Promise<string> {
        this.transcription_engine = this.transcription_engines[this.settings.transcription_engine]; 
        return this.transcription_engine(file);
    }

    async getTranscriptionWhisperASR(file: TFile): Promise<string> {
        // Now that we have the form data payload as an array buffer, we can pass it to requestURL
        // We also need to set the content type to multipart/form-data and pass in the Boundary string

        const [request_body, randomBoundaryString] = await fileToRequestPayload(file, this.vault);

        const options: RequestUrlParam = {
            method: 'POST',
            url: `${this.settings.whisperASRUrl}/asr?task=transcribe&language=en`,
            contentType: `multipart/form-data; boundary=----${randomBoundaryString}`,
            body: request_body
        };

        // Decode and inspect the body
        if (this.settings.debug) {
            const decoder = new TextDecoder();
            console.log(decoder.decode(request_body));
        }

        if (this.settings.debug) console.log("Transcribing with WhisperASR");
        return requestUrl(options).then(async (response) => {
            if (this.settings.debug) console.log(response);

            // WhisperASR returns a JSON object with a text field containing the transcription and segments field
            if (this.settings.timestamps) {

                var transcription: string = "";
                const duration_seconds = Math.floor(response.json.segments[response.json.segments.length - 1].end);
                var start_iso_slice = 14;
                if (duration_seconds >= 3600) start_iso_slice = 11;
                for (var s of response.json.segments) {
                    if (typeof s.start === 'number' && typeof s.text === 'string') {
                        // Convert the start and end times to ISO 8601 format and then substring to get the HH:MM:SS portion
                        const start = new Date(Math.floor(s.start) * 1000).toISOString().substring(start_iso_slice, 19)
                        const end = new Date(Math.floor(s.end) * 1000).toISOString().substring(start_iso_slice, 19)
                        const timestamp = `\`[${start} - ${end}]\``
                        // Add the timestamp and the text to the transcription
                        transcription += timestamp + ': ' + s.text + "\n"
                    }
                    else {
                        console.error("WhisperASR returned an invalid segment")
                    }
                }
                return transcription;
            }

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

        if (this.settings.debug) console.log("Transcribing with Scribe");

        let api_base: string
        if (this.settings.debug) api_base = 'https://dev.api.gambitengine.com'
        else api_base = 'https://api.gambitengine.com'

        let url = `${api_base}/v1/scribe/transcriptions`
        const create_transcription_request: RequestUrlParam = {
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${this.settings.scribeToken}`
            },
        }

        if (this.settings.debug) console.log("Transcribing with Scribe");
        // Create the transcription request, then upload the file to Scribe S3
        return requestUrl(create_transcription_request).then(async (response) => {
            if (this.settings.debug) console.log(response);
            const create_transcription_response: paths['/v1/scribe/transcriptions']['post']['responses']['201']['content']['application/json'] = response.json;

            if (this.settings.debug) console.log(create_transcription_response);
            if (this.settings.debug) console.log('Uploading file to Scribe S3...');

            if (create_transcription_response.upload_request === undefined || create_transcription_response.upload_request.url === undefined || create_transcription_response.upload_request.fields === undefined) {
                if (this.settings.debug) console.error('Scribe returned an invalid upload request');
                return Promise.reject('Scribe returned an invalid upload request');
            }

            // Create the form data payload
            let payload_data: PayloadData = {}

            for (const [key, value] of Object.entries(create_transcription_response.upload_request.fields)) {
                if (typeof key === 'string' && typeof value === 'string') payload_data[key] = value;
                else {
                    if (this.settings.debug) console.error('Scribe returned an invalid upload request');
                    return Promise.reject('Scribe returned an invalid upload request');
                }
            }

            const data = new Blob([await this.vault.readBinary(file)]);
            payload_data['file'] = data;

            // Convert it to an array buffer
            const [request_body, boundary_string] = await payloadGenerator(payload_data);
            console.log(request_body);

            // Decode return data and inspect
            if (this.settings.debug) {
                const decoder = new TextDecoder();
                console.log('Request body:')
                console.log(decoder.decode(request_body));
            }

            const upload_file_request: RequestUrlParam = {
                method: 'POST',
                url: create_transcription_response.upload_request.url,
                contentType: `multipart/form-data; boundary=----${boundary_string}`,
                body: request_body
            }

            // Upload the file to Scribe S3
            return requestUrl(upload_file_request).then(async (response) => {
                if (this.settings.debug) console.log(response);

                // Wait for Scribe to finish transcribing the file
                return 'Transcription'

            }).catch((error) => {
                if (this.settings.debug) console.error(error);
                return Promise.reject(error);
            });


        }).catch((error) => {
            if (this.settings.debug) console.error(error);
            return Promise.reject(error);
        });
    }
}
