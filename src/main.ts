import { ChildProcess } from 'child_process';
import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, TFile, Notice } from 'obsidian';
import { TranscriptionEngine } from 'src/transcribe';

interface TranscriptionSettings {
	timestamps: boolean;
	transcribeFileExtensions: string;
	whisperASRUrl: string;
	debug: boolean;
	scribeToken: string;
	transcription_engine: string
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
	timestamps: false,
	transcribeFileExtensions: 'mp3,wav,webm',
	whisperASRUrl: 'http://localhost:9000',
	debug: false,
	scribeToken: '',
	transcription_engine: 'Scribe'
}

export default class Transcription extends Plugin {

	settings: TranscriptionSettings;
	public static plugin: Plugin;
	public static children: Array<ChildProcess> = [];
	public transcription_engine: TranscriptionEngine;

	async onload() {
		await this.loadSettings();
		Transcription.plugin = this;
		if (this.settings.debug) console.log('Loading Obsidian Transcription');
		this.transcription_engine = new TranscriptionEngine(this.settings, this.app.vault)

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
				console.log(this.app.metadataCache);

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

					this.transcription_engine.getTranscription(fileToTranscribe).then(async (transcription) => {
						if (this.settings.debug) console.log(transcription);

						var fileText = await this.app.vault.read(view.file)
						const fileLinkString = this.app.metadataCache.fileToLinktext(fileToTranscribe, view.file.path); // This is the string that is used to link the audio file in the markdown file. If files are moved this potentially breaks, but Obsidian has built-in handlers for this, and handling that is outside the scope of this plugin
						const fileLinkStringTagged = `[[${fileLinkString}]]`; // This is the string that is used to link the audio file in the markdown file.
						console.log(fileLinkString)

						// Perform a string replacement, add the transcription to the next line after the file link
						const startReplacementIndex = fileText.indexOf(fileLinkStringTagged) + fileLinkStringTagged.length;
						// fileText = [fileText.slice(0, startReplacementIndex), `\n\`\`\`${transcription}\`\`\``, fileText.slice(startReplacementIndex)].join('');
						fileText = [fileText.slice(0, startReplacementIndex), `\n${transcription}`, fileText.slice(startReplacementIndex)].join('');

						// Now that we have the file lines with the transcription, we can write the file
						await this.app.vault.modify(view.file, fileText);

					}).catch((error) => {
						if (this.settings.debug) new Notice('Error transcribing file ' + fileToTranscribe.name + ': ' + error);
						else new Notice('Error transcribing file, enable debug mode to see more');
					});
				}
			}
		});

		// Kill child processes when the plugin is unloaded
		this.app.workspace.on("quit", () => {
			Transcription.children.forEach((child) => {
				child.kill();
			});
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
			.setName('General Settings')
			.setHeading()

		new Setting(containerEl)
			.setName('Transcription engine')
			.setDesc('The transcription engine to use')
			.setClass('transcription-engine-setting')
			.addDropdown(dropdown => dropdown
				.addOption('scribe', 'Scribe')
				.addOption('whisper_asr', 'Whisper ASR')
				.setValue(this.plugin.settings.transcription_engine)
				.onChange(async (value) => {
					this.plugin.settings.transcription_engine = value;
					await this.plugin.saveSettings();
					// Hide the settings for the other transcription engine
					if (value == 'scribe') {
						containerEl.findAll('.scribe-settings').forEach((element) => { element.style.display = 'block'; });
						containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'none'; });
					}
					else if (value == 'whisper_asr') {
						containerEl.findAll('.scribe-settings').forEach((element) => { element.style.display = 'none'; });
						containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'block'; });
					}
				}));

		new Setting(containerEl)
			.setName('Enable timestamps')
			.setDesc('Add timestamps to the beginning of each line')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.timestamps)
				.onChange(async (value) => {
					this.plugin.settings.timestamps = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Scribe Settings')
			.setClass('scribe-settings')
			.setHeading()

		new Setting(containerEl)
			.setName('Scribe Token')
			.setDesc('The token used to authenticate with the Scribe API. Get one at https://gambitengine.com/scribe')
			.setClass('scribe-settings')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.scribeToken)
				.setValue(this.plugin.settings.scribeToken)
				.onChange(async (value) => {
					this.plugin.settings.scribeToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Whisper ASR Settings')
			.setClass('whisper-asr-settings')
			.setHeading()

		new Setting(containerEl)
			.setName('Whisper ASR URL')
			.setDesc('The URL of the Whisper ASR server: https://github.com/ahmetoner/whisper-asr-webservice')
			.setClass('whisper-asr-settings')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.whisperASRUrl)
				.setValue(this.plugin.settings.whisperASRUrl)
				.onChange(async (value) => {
					this.plugin.settings.whisperASRUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Advanced Settings')
			.setHeading()

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable debug mode to see more console logs')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debug)
				.onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}));

		// Initially hide the settings for the other transcription engine
		if (this.plugin.settings.transcription_engine == 'scribe') {
			containerEl.findAll('.scribe-settings').forEach((element) => { element.style.display = 'block'; });
			containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'none'; });
		}
		else if (this.plugin.settings.transcription_engine == 'whisper_asr') {
			containerEl.findAll('.scribe-settings').forEach((element) => { element.style.display = 'none'; });
			containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'block'; });
		}
	}
}

export type { TranscriptionSettings };
