import { ChildProcess } from 'child_process';
import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, TFile, Notice, Platform } from 'obsidian';
import { TranscriptionEngine } from 'src/transcribe';
import { StatusBar } from './status';
import { createClient, User } from "@supabase/supabase-js"

interface TranscriptionSettings {
	timestamps: boolean;
	timestampFormat: string;
	translate: boolean;
	verbosity: number;
	whisperASRUrl: string;
	debug: boolean;
	dev: boolean;
	transcription_engine: string
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
	timestamps: false,
	timestampFormat: 'HH:mm:ss',
	translate: false,
	verbosity: 1,
	whisperASRUrl: 'http://localhost:9000',
	debug: false,
	dev: false,
	transcription_engine: 'swiftink'
}

export default class Transcription extends Plugin {

	settings: TranscriptionSettings;
	public static plugin: Plugin;
	public static children: Array<ChildProcess> = [];
	private static transcribeFileExtensions: string[] = ['mp3', 'wav', 'webm', 'ogg', 'flac', 'm4a', 'aac', 'amr', 'opus', 'aiff', 'm3gp', 'mp4', 'm4v', 'mov', 'avi', 'wmv', 'flv', 'mpeg', 'mpg', 'mkv']
	public transcription_engine: TranscriptionEngine;
	statusBar: StatusBar;
	public supabase = createClient(
		'https://auth.swiftink.io',
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZGVxZ3JzcWFleHBub2dhdWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODU2OTM4NDUsImV4cCI6MjAwMTI2OTg0NX0.BBxpvuejw_E-Q_g6SU6G6sGP_6r4KnrP-vHV2JZpAho',
		{
			auth: {
				detectSessionInUrl: false,
				autoRefreshToken: true,
				persistSession: true,
			}
		}
	);
	public user: User | null;

	async onload() {
		await this.loadSettings();

		Transcription.plugin = this;
		console.log('Loading Obsidian Transcription');
		if (this.settings.debug) console.log('Debug mode enabled');
		if (this.settings.debug) console.log(await this.supabase.auth.getSession());

		// Prompt the user to sign in if the have Swiftink selected and are not signed in
		if (
			this.settings.transcription_engine == 'swiftink' &&
			(await this.supabase.auth.getSession().then((res) => { return res.data.session == null }))) {
			new Notice('Please sign in to Swiftink.io via the settings tab', 4000);
		}
		else if (this.settings.transcription_engine == 'swiftink') {
			this.user = await this.supabase.auth.getUser().then((res) => { return res.data.user || null });
		}

		if (!Platform.isMobileApp) {
			this.statusBar = new StatusBar(this.addStatusBarItem());
			this.registerInterval(
				window.setInterval(() => this.statusBar.display(), 1000)
			);
		}

		this.transcription_engine = new TranscriptionEngine(this.settings, this.app.vault, this.statusBar, this.supabase);
		const transcribeAndWrite = async (parent_file: TFile, file: TFile) => {
			if (this.settings.debug) console.log('Transcribing ' + file.path);
			// Check if view has file

			this.transcription_engine.getTranscription(file).then(async (transcription) => {
				let fileText = await this.app.vault.read(parent_file)
				const fileLinkString = this.app.metadataCache.fileToLinktext(file, parent_file.path); // This is the string that is used to link the audio file in the markdown file. If files are moved this potentially breaks, but Obsidian has built-in handlers for this, and handling that is outside the scope of this plugin
				const fileLinkStringTagged = `[[${fileLinkString}]]`; // This is the string that is used to link the audio file in the markdown file.
				console.log(fileLinkString)

				// Perform a string replacement, add the transcription to the next line after the file link
				const startReplacementIndex = fileText.indexOf(fileLinkStringTagged) + fileLinkStringTagged.length;
				// fileText = [fileText.slice(0, startReplacementIndex), `\n\`\`\`${transcription}\`\`\``, fileText.slice(startReplacementIndex)].join('');
				fileText = [fileText.slice(0, startReplacementIndex), `\n${transcription}`, fileText.slice(startReplacementIndex)].join('');

				// Now that we have the file lines with the transcription, we can write the file
				await this.app.vault.modify(parent_file, fileText);

			}).catch((error) => {
				if (this.settings.debug) new Notice('Error transcribing file ' + file.name + ': ' + error);
				else if (this.settings.dev) throw error;
				else new Notice('Error transcribing file, enable debug mode to see more');
			});
		}

		this.addCommand({
			id: 'obsidian-transcription-transcribe-all-in-view',
			name: 'Transcribe all audio files in view',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// Get the current filepath
				const markdownFilePath = view.file?.path;
				if (markdownFilePath === undefined) {
					if (this.settings.debug) console.log('Could not get markdown file path');
					return;
				}
				if (this.settings.debug) console.log('Transcribing all audio files in ' + markdownFilePath);
				new Notice('Transcribing all audio files in ' + view.file?.name, 3000);

				// Get all linked files in the markdown file
				const filesLinked = Object.keys(this.app.metadataCache.resolvedLinks[markdownFilePath]);

				// Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
				const filesToTranscribe: TFile[] = [];
				for (const linkedFilePath of filesLinked) {
					const linkedFileExtension = linkedFilePath.split('.').pop();
					if (linkedFileExtension === undefined || !Transcription.transcribeFileExtensions.includes(linkedFileExtension.toLowerCase())) {
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
				if (view.file === null) {
					if (this.settings.debug) console.error('Could not get markdown file path');
					return;
				}
				for (const fileToTranscribe of filesToTranscribe) {
					transcribeAndWrite(view.file, fileToTranscribe);
				}
			}
		});


		// Register a command to transcribe a media file when right-clicking on it
		// this.registerEvent(
		// 	// if (!Transcription.transcribeFileExtensions.includes(view.file.extension.toLowerCase())) return;
		// 	this.app.workspace.on("file-menu", (menu: Menu, file) => {
		// 		if (file instanceof TFolder) return;
		// 		// if (file.parent instanceof TFolder) return;
		// 		if (!(file instanceof TFile)) return;
		// 		console.log(file)
		// 		menu.addItem((item) => {
		// 			item
		// 				.setTitle("Transcribe File 🖊️")
		// 				.setIcon("document")
		// 				.onClick(async () => {
		// 					if (!Transcription.transcribeFileExtensions.includes(file.extension.toLowerCase())) return;
		// 					// transcribeAndWrite(file.parent, file)
		// 					new Notice(file.path);
		// 				});
		// 		});
		// 	})
		// );

		// Kill child processes when the plugin is unloaded
		this.app.workspace.on("quit", () => {
			Transcription.children.forEach((child) => {
				child.kill();
			});
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TranscriptionSettingTab(this.app, this));

		this.registerObsidianProtocolHandler('swiftink_auth', async (callback) => {
			const params = new URLSearchParams(callback.hash);
			const access_token = params.get('access_token');
			const refresh_token = params.get('refresh_token');

			if (!access_token || !refresh_token) {
				new Notice('Error authenticating with Swiftink.io');
				return;
			}

			await this.supabase.auth.setSession({ access_token: access_token, refresh_token: refresh_token })
			this.user = await this.supabase.auth.getUser().then((res) => { return res.data.user || null });
			new Notice('Successfully authenticated with Swiftink.io');

			// Show the settings for user auth/unauth based on whether the user is signed in
			if (this.user == null) {
				document.querySelectorAll('.swiftink-unauthed-only').forEach((element) => { element.setAttribute('style', 'display: block !important'); });
				document.querySelectorAll('.swiftink-authed-only').forEach((element) => { element.setAttribute('style', 'display: none !important'); });
			}
			else {
				document.querySelectorAll('.swiftink-unauthed-only').forEach((element) => { element.setAttribute('style', 'display: none !important'); });
				document.querySelectorAll('.swiftink-authed-only').forEach((element) => { element.setAttribute('style', 'display: block !important'); });
				// Also set the user's email in the settings tab
				document.querySelectorAll('.swiftink-manage-account-btn').forEach((element) => { element.innerHTML = `Manage ${this.user?.email}` });
			}
			return;
		});

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
			.setTooltip('Swiftink.io is a free cloud based transcription engine (no local set up, additional AI features). Whisper ASR is a self-hosted local transcription engine that uses a Python app (requires local setup).')
			.setClass('transcription-engine-setting')
			.addDropdown(dropdown => dropdown
				.addOption('swiftink', 'Swiftink')
				.addOption('whisper_asr', 'Whisper ASR')
				.setValue(this.plugin.settings.transcription_engine)
				.onChange(async (value) => {
					this.plugin.settings.transcription_engine = value;
					await this.plugin.saveSettings();
					// Hide the settings for the other transcription engine
					if (value == 'swiftink') {
						containerEl.findAll('.swiftink-settings').forEach((element) => { element.style.display = 'block'; });
						containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'none'; });
					}
					else if (value == 'whisper_asr') {
						containerEl.findAll('.swiftink-settings').forEach((element) => { element.style.display = 'none'; });
						containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'block'; });
					}
				}));

		new Setting(containerEl)
			.setName('Notice verbosity')
			.setDesc('How granularly notices should be displayed')
			.setTooltip('Verbose will display a notice for every event in the backend. Normal will display a notice for every major event, such as successful transcription or file upload. Silent will not display any notices.')
			.addDropdown(dropdown => dropdown
				.addOption('0', 'Silent')
				.addOption('1', 'Normal')
				.addOption('2', 'Verbose')
				.setValue(this.plugin.settings.verbosity.toString())
				.onChange(async (value) => {
					this.plugin.settings.verbosity = parseInt(value);
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Swiftink Settings')
			.setClass('swiftink-settings')
			.setHeading()

		new Setting(containerEl)
			.setClass('swiftink-settings')
			.setName('Swiftink.io Account')
			.addButton((bt) => {
				bt.setButtonText('Sign in with Google');
				bt.setClass('swiftink-unauthed-only')
				bt.onClick(async () => {
					this.plugin.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'obsidian://swiftink_auth' } })
				});
			})
			.addButton((bt) => {
				bt.setButtonText('Sign in with GitHub');
				bt.setClass('swiftink-unauthed-only')
				bt.onClick(async () => {
					this.plugin.supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: 'obsidian://swiftink_auth' } })
				});
			})
			.addButton((bt) => {
				bt.setButtonText('Log out');
				bt.setClass('swiftink-authed-only')
				bt.onClick(async () => {
					await this.plugin.supabase.auth.signOut();
					this.plugin.user = null;
					containerEl.findAll('.swiftink-unauthed-only').forEach((element) => { element.style.display = 'block'; });
					containerEl.findAll('.swiftink-authed-only').forEach((element) => { element.style.display = 'none'; });
					new Notice('Successfully logged out');
				});
			})
			.addButton((bt) => {
				bt.setButtonText(`Manage ${this.plugin.user?.email}`);
				bt.setClass('swiftink-authed-only')
				bt.setClass('swiftink-manage-account-btn')
				bt.onClick(() => {
					window.open('https://swiftink.io/home/account', '_blank');
				});
			});

		new Setting(containerEl)
			.setName('Enable timestamps')
			.setDesc('Add timestamps to the beginning of each line')
			.setClass('swiftink-settings')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.timestamps)
				.onChange(async (value) => {
					this.plugin.settings.timestamps = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Timestamp format')
			.setDesc('The format of the timestamps: date-fns.org/docs/format')
			.setClass('swiftink-settings')
			.addDropdown(dropdown => dropdown
				.addOption('HH:mm:ss', 'HH:mm:ss')
				.addOption('mm:ss', 'mm:ss')
				.addOption('ss', 'ss')
				.setValue(this.plugin.settings.timestampFormat)
				.onChange(async (value) => {
					this.plugin.settings.timestampFormat = value;
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
					// If this is toggled off, also turn off dev mode
					if (!value) this.plugin.settings.dev = false;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Dev mode')
			.setDesc('Enable dev mode to use the dev version of the plugin - only use this if you\'re a beta tester or developer, email sulaiman@swiftink.io for more info')
			.setClass('dev-mode')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dev)
				.onChange(async (value) => {
					this.plugin.settings.dev = value;
					await this.plugin.saveSettings();
				}));

		// Initially hide the settings for the other transcription engine
		if (this.plugin.settings.transcription_engine == 'swiftink') {
			containerEl.findAll('.swiftink-settings').forEach((element) => { element.style.display = 'block'; });
			containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'none'; });
		}
		else if (this.plugin.settings.transcription_engine == 'whisper_asr') {
			containerEl.findAll('.swiftink-settings').forEach((element) => { element.style.display = 'none'; });
			containerEl.findAll('.whisper-asr-settings').forEach((element) => { element.style.display = 'block'; });
		}

		// Initially hide the settings for user auth/unauth based on whether the user is signed in
		if (this.plugin.user == null) {
			containerEl.findAll('.swiftink-unauthed-only').forEach((element) => { element.style.display = 'block'; });
			containerEl.findAll('.swiftink-authed-only').forEach((element) => { element.style.display = 'none'; });
		}
		else {
			containerEl.findAll('.swiftink-unauthed-only').forEach((element) => { element.style.display = 'none'; });
			containerEl.findAll('.swiftink-authed-only').forEach((element) => { element.style.display = 'block'; });
		}

		// If debug mode is off, hide the dev mode setting
		if (!this.plugin.settings.debug) {
			containerEl.findAll('.dev-mode').forEach((element) => { element.style.display = 'none'; });
		}
		else {
			containerEl.findAll('.dev-mode').forEach((element) => { element.style.display = 'block'; });
		}
	}
}

export type { TranscriptionSettings };
