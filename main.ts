import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, requestUrl, RequestUrlParam, getBlobArrayBuffer, TFile, Notice } from 'obsidian';
import { getAllLinesFromFile } from 'utils';

interface TranscriptionSettings {
	transcribeFileExtensions: string;
	whisperASRUrl: string;
	debug: boolean;
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
	transcribeFileExtensions: 'mp3,wav,webm',
	whisperASRUrl: 'http://localhost:9000',
	debug: false
}

export default class Transcription extends Plugin {
	settings: TranscriptionSettings;

	async onload() {
		await this.loadSettings();
		if (this.settings.debug) console.log('Loading Obsidian Transcription');

		this.addCommand({
			id: 'obsidian-transcription-transcribe-all-in-view',
			name: 'Transcribe all audio files in view',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// Get the current filepath
				const markdownFilePath = view.file.path;
				if (this.settings.debug) console.log('Transcribing all audio files in ' + markdownFilePath);
				new Notice('Transcribing all audio files in ' + view.file.name, 3000);

				// Get all linked files in the markdown file
				const filesLinked = Object.keys(this.app.metadataCache.resolvedLinks[markdownFilePath]);

				// Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
				const filesToTranscribe: TFile[] = [];
				for (const linkedFilePath of filesLinked) {
					const linkedFileExtension = linkedFilePath.split('.').pop();
					if (linkedFileExtension === undefined || !this.settings.transcribeFileExtensions.split(',').includes(linkedFileExtension)) {
						if (this.settings.debug) console.log('Skipping ' + linkedFilePath + ' because the file extension is not in the list of transcribeable file extensions');
						continue;
					}

					// We now know that the file extension is in the list of transcribeable file extensions
					const linkedFile = this.app.vault.getAbstractFileByPath(linkedFilePath);

					// Validate that we are dealing with a file and add it to the list of verified files to transcribe 
					if (linkedFile instanceof TFile) filesToTranscribe.push(linkedFile);
					else {
						if (this.settings.debug) console.log('Could not find file ' + linkedFilePath);
						continue;
					}
				}

				// Now that we have all the files to transcribe, we can transcribe them
				for (const fileToTranscribe of filesToTranscribe) {
					if (this.settings.debug) console.log('Transcribing ' + fileToTranscribe.path);

					// This next block is a workaround to current Obsidian API limitations: requestURL only supports string data or an unnamed blob, not key-value formdata
					// Essentially what we're doing here is constructing a multipart/form-data payload manually as a string and then passing it to requestURL
					// I believe this to be equivilent to the following curl command: curl --location --request POST 'http://djmango-bruh:9000/asr?task=transcribe&language=en' --form 'audio_file=@"test-vault/02 Files/Recording.webm"'

					// Generate the form data payload boundry string, it can be arbitrary, I'm just using a random string here
					// https://stackoverflow.com/questions/3508338/what-is-the-boundary-in-multipart-form-data
					// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
					const N = 16 // The length of our random boundry string
					const randomBoundryString = "djmangoBoundry" + Array(N + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, N)

					// Construct the form data payload as a string
					const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="audio_file"; filename="blob"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
					const post_string = `\r\n------${randomBoundryString}--`

					// Convert the form data payload to a blob by concatenating the pre_string, the file data, and the post_string, and then return the blob as an array buffer
					const pre_string_encoded = new TextEncoder().encode(pre_string);
					// const data = new Blob([await this.app.vault.adapter.readBinary(fileToTranscribe.path)]);
					const data = new Blob([await this.app.vault.readBinary(fileToTranscribe)]);
					const post_string_encoded = new TextEncoder().encode(post_string);
					const concatenated = await new Blob([pre_string_encoded, await getBlobArrayBuffer(data), post_string_encoded]).arrayBuffer()

					// Now that we have the form data payload as an array buffer, we can pass it to requestURL
					// We also need to set the content type to multipart/form-data and pass in the boundry string
					const options: RequestUrlParam = {
						method: 'POST',
						url: `${this.settings.whisperASRUrl}/asr?task=transcribe&language=en`,
						contentType: `multipart/form-data; boundary=----${randomBoundryString}`,
						body: concatenated
					};

					requestUrl(options).then(async (response) => {
						if (this.settings.debug) console.log(response);
						const transcription = response.json.text;
						if (this.settings.debug) console.log(transcription);

						const markdownFileLines = getAllLinesFromFile(await this.app.vault.read(view.file));
						const fileLinkString = `[[${fileToTranscribe.name}]]`; // This is the string that is used to link the audio file in the markdown file. There are potentially other ways to link the file, but this is the only one I know of 

						// Iterate through the lines of the markdown file and find the line that contains the file link
						let fileLinkLineIndex: number | undefined = undefined;
						for (const line of markdownFileLines) {
							if (line.includes(fileLinkString)) {
								fileLinkLineIndex = markdownFileLines.indexOf(line);
								break;
							}
						}

						if (fileLinkLineIndex === undefined) {
							if (this.settings.debug) console.log('Could not find transcription line for ' + fileToTranscribe.name + ' in ' + view.file.name);
							return;
						}

						// Now that we have the line index of the file link, we can insert the transcription line after it. Potential for custom format here
						markdownFileLines[fileLinkLineIndex] = markdownFileLines[fileLinkLineIndex] + '\n' + transcription;

						// Now that we have the file lines with the transcription, we can write the file
						await this.app.vault.modify(view.file, markdownFileLines.join('\n'));

					}).catch((error) => {
						if (this.settings.debug) {
							console.error(error);
							new Notice('Error transcribing file ' + fileToTranscribe.name + ': ' + error);
						}
						else {
							new Notice('Error transcribing file, enable debug mode to see more');
						}
					});
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TranscriptionSettingTab(this.app, this));
	}

	onunload() {
		if (this.settings.debug) console.log('Unloading Obsidian Transcription');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TranscriptionSettingTab extends PluginSettingTab {
	plugin: Transcription;

	constructor(app: App, plugin: Transcription) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Obsidian Transcription' });

		new Setting(containerEl)
			.setName('Whisper ASR URL')
			.setDesc('The URL of the Whisper ASR server: https://github.com/ahmetoner/whisper-asr-webservice')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.whisperASRUrl)
				.setValue(this.plugin.settings.whisperASRUrl)
				.onChange(async (value) => {
					this.plugin.settings.whisperASRUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Allowed file extensions')
			.setDesc('Comma-separated list of file extensions to transcribe')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.transcribeFileExtensions)
				.setValue(this.plugin.settings.transcribeFileExtensions)
				.onChange(async (value) => {
					this.plugin.settings.transcribeFileExtensions = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable debug mode to see more console logs')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debug)
				.onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}));
	}
}
