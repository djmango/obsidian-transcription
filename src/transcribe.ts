import { TranscriptionSettings } from "src/main";
import { Notice, requestUrl, RequestUrlParam, TFile, Vault } from "obsidian";
import { format } from "date-fns";
import { paths, components } from "./types/swiftink";
import { payloadGenerator, PayloadData } from "src/utils";
import { StatusBar } from "./status";
import axios from "axios";

// This class is the parent for transcription engines. It takes settings and a file as an input and returns a transcription as a string

type TranscriptionBackend = (file: TFile) => Promise<string>;

export class TranscriptionEngine {
	settings: TranscriptionSettings;
	vault: Vault;
	status_bar: StatusBar | null;

	transcriptionEngine: TranscriptionBackend

	transcription_engines: { [key: string]: TranscriptionBackend } = {
		"swiftink": this.getTranscriptionSwiftink,
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
			url: `${this.settings.whisperASRUrl}/asr?task=transcribe&language=en`,
			contentType: `multipart/form-data; boundary=----${boundary_string}`,
			body: request_body
		};

		return requestUrl(options).then(async (response) => {
			if (this.settings.debug) console.log(response);
			// WhisperASR returns a JSON object with a text field containing the transcription and segments field

			// Pull transcription from either response.text or response.json.text
			if (typeof response.text === 'string') return response.text;
			else return response.json.text;

		}).catch((error) => {
			if (this.settings.debug) console.error(error);
			return Promise.reject(error);
		});
	}

	async getTranscriptionSwiftink(file: TFile): Promise<string> {
		// Declare constants for the API
		let api_base: string
		if (this.settings.dev) api_base = 'http://localhost:8000'
		// if (this.settings.dev) api_base = 'https://api.swiftink.io'
		else api_base = 'https://api.swiftink.io'

		let url = `${api_base}/transcripts/upload`
		let headers = { 'Authorization': `Bearer ${this.settings.swiftinkToken}` }
		console.log(headers)

		// Get a Pre-signed URL from Swiftink
		const upload_response = await axios.post(url, {}, { headers: headers })
		const upload_data: paths['/transcripts/upload']['post']['responses']['201']['content']['application/json'] = upload_response.data

		// Now POST the file to the Pre-signed URL
		if (this.settings.debug) console.log('Uploading file to Swiftink...');
		if (this.settings.verbosity >= 1) {
			if (this.status_bar !== null) this.status_bar.displayMessage('Uploading...', 5000);
			else new Notice('Uploading file to Swiftink...', 3000);
		}
		const upload_file_request = await axios.post(upload_data.url, await this.vault.readBinary(file))

		if (this.settings.debug) console.log(upload_file_request);
		return ''

		// Wait for Swiftink to finish transcribing the file

		// const get_transcription_request: RequestUrlParam = {
		// 	method: 'GET',
		// 	url: `${api_base}/transcripts/${create_transcription_response.id}`,
		// 	headers: { 'Authorization': `Bearer ${this.settings.swiftinkToken}` }
		// }

		// if (this.settings.debug) console.log('Waiting for Swiftink to finish transcribing...');

		// // Poll Swiftink until the transcription is complete
		// let tries = 0;
		// const max_tries = 200;
		// const sleep_time = 3000;

		// // eslint-disable-next-line no-constant-condition
		// while (true) {
		// 	// Get the transcription status
		// 	const transcription: paths['/transcripts/{id}']['get']['responses']['200']['content']['application/json'] = await requestUrl(get_transcription_request).json;
		// 	if (this.settings.debug) console.log(transcription);

		// 	// If the transcription is complete, return the transcription text
		// 	if (transcription.status == 'complete' &&
		// 		transcription.text_segments !== undefined &&
		// 		transcription.text !== undefined) {
		// 		// Idk how asserts work in JS, but this should be an assert

		// 		if (this.settings.debug) console.log('Swiftink finished transcribing');
		// 		if (this.settings.verbosity >= 1) {
		// 			if (this.status_bar !== null) this.status_bar.displayMessage('100% - Complete!', 3000, true);
		// 			else new Notice('Swiftink finished transcribing', 3000)
		// 		}

		// 		if (this.settings.timestamps) return this.segmentsToTimestampedString(transcription.text_segments, this.settings.timestampFormat);
		// 		else return transcription.text;
		// 	}
		// 	else if (tries > max_tries) {
		// 		if (this.settings.debug) console.error('Swiftink took too long to transcribe the file');
		// 		return Promise.reject('Swiftink took too long to transcribe the file');
		// 	}
		// 	else if (transcription.status == 'failed') {
		// 		if (this.settings.debug) console.error('Swiftink failed to transcribe the file');
		// 		return Promise.reject('Swiftink failed to transcribe the file');
		// 	}
		// 	else if (transcription.status == 'validation_failed') {
		// 		if (this.settings.debug) console.error('Swiftink has detected an invalid file');
		// 		return Promise.reject('Swiftink has detected an invalid file');
		// 	}
		// 	// If the transcription is still in progress, wait 3 seconds and try again
		// 	else {
		// 		tries += 1;
		// 		await sleep(sleep_time);
		// 	}
		// }
	}
}
