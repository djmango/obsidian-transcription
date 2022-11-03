import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, TAbstractFile, requestUrl, RequestUrlParam, getBlobArrayBuffer } from 'obsidian';

interface ObsidianTranscriptionSettings {
	transcribeFileExtensions: string;
}

const DEFAULT_SETTINGS: ObsidianTranscriptionSettings = {
	transcribeFileExtensions: 'mp3,wav,webm'
}

export default class ObsidianTranscription extends Plugin {
	settings: ObsidianTranscriptionSettings;

	async onload() {
		console.log('Loading Obsidian Transcription');
		await this.loadSettings();

		this.addCommand({
			id: 'obsidian-transcription-transcribe-all-in-view',
			name: 'Transcribe all audio files in view',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// Get the current filepath
				const markdownFilePath = view.file.path;
				console.log('Transcribing all audio files in ' + markdownFilePath);

				// Get all linked files in the markdown file
				const filesLinked = Object.keys(this.app.metadataCache.resolvedLinks[markdownFilePath]);

				// Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
				const filesToTranscribe: TAbstractFile[] = [];
				for (const linkedFilePath of filesLinked) {
					const linkedFileExtension = linkedFilePath.split('.').pop();
					if (linkedFileExtension === undefined || !this.settings.transcribeFileExtensions.split(',').includes(linkedFileExtension)) {
						console.log('Skipping ' + linkedFilePath + ' because the file extension is not in the list of transcribeable file extensions');
						continue;
					}

					// We now know that the file extension is in the list of transcribeable file extensions
					const linkedFile = this.app.vault.getAbstractFileByPath(linkedFilePath);

					// If the file is not found, we skip it
					if (linkedFile === null) {
						console.log('Could not find file ' + linkedFilePath);
						continue;
					}
					filesToTranscribe.push(linkedFile)
				}

				// Now that we have all the files to transcribe, we can transcribe them
				for (const fileToTranscribe of filesToTranscribe) {
					console.log('Transcribing ' + fileToTranscribe.path);

					// This next block is a workaround to current Obsidian API limitations: requestURL only supports string data or an unnamed blob, not key-value formdata
					// Essentially what we're doing here is constructing a multipart/form-data payload manually as a string and then passing it to requestURL
					// I believe this to be equivilent to the following curl command: curl --location --request POST 'http://djmango-bruh:9000/asr?task=transcribe&language=en' --form 'audio_file=@"test-vault/02 Files/Recording.webm"'
					
					// Generate the form data payload boundry string, it can be arbitrary, I'm just using a random string here
					// https://stackoverflow.com/questions/3508338/what-is-the-boundary-in-multipart-form-data
					// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
					const N = 16 // The length of our random boundry string
					const randomBoundryString = "djmangoBoundry" + Array(N+1).join((Math.random().toString(36)+'00000000000000000').slice(2, 18)).slice(0, N) 
					
					// Construct the form data payload as a string
					const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="audio_file"; filename="blob"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
					const post_string = `\r\n------${randomBoundryString}--`
					
					// Convert the form data payload to a blob by concatenating the pre_string, the file data, and the post_string, and then return the blob as an array buffer
					const pre_string_encoded = new TextEncoder().encode(pre_string);
					const data = new Blob([await this.app.vault.adapter.readBinary(fileToTranscribe.path)]);
					const post_string_encoded = new TextEncoder().encode(post_string);
					const concatenated = await new Blob([pre_string_encoded, await getBlobArrayBuffer(data), post_string_encoded]).arrayBuffer()

					// Now that we have the form data payload as an array buffer, we can pass it to requestURL
					// We also need to set the content type to multipart/form-data and pass in the boundry string
					const options: RequestUrlParam = {
						method: 'POST',
						url: 'http://djmango-bruh:9000/asr?task=transcribe&language=en',
						contentType: `multipart/form-data; boundary=----${randomBoundryString}`,
						body: concatenated
					};

					requestUrl(options).then((response) => {
						console.log(response);
					}).catch((error) => {
						console.error(error);
					});
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidianTranscriptionSettingTab(this.app, this));
	}

	onunload() {
		console.log('Unloading Obsidian Transcription');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ObsidianTranscriptionSettingTab extends PluginSettingTab {
	plugin: ObsidianTranscription;

	constructor(app: App, plugin: ObsidianTranscription) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Obsidian Transcription' });

		new Setting(containerEl)
			.setName('Allowed file extensions')
			.setDesc('Comma-separated list of file extensions to transcribe')
			.addText(text => text
				.setPlaceholder('mp3,wav,webm')
				.setValue(this.plugin.settings.transcribeFileExtensions)
				.onChange(async (value) => {
					console.log('Allowed file extensions: ' + value);
					this.plugin.settings.transcribeFileExtensions = value;
					await this.plugin.saveSettings();
				}));
	}
}
