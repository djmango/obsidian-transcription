import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { Transcription } from "./main";

interface TranscriptionSettings {
	timestamps: boolean;
	timestampFormat: string;
	translate: boolean;
	verbosity: number;
	whisperASRUrl: string;
	debug: boolean;
	transcription_engine: string;
	embedAdditionalFunctionality: boolean;
	embedSummary: boolean;
	embedOutline: boolean;
	embedKeywords: boolean;
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
	timestamps: false,
	timestampFormat: "HH:mm:ss",
	translate: false,
	verbosity: 1,
	whisperASRUrl: "http://localhost:9000",
	debug: false,
	transcription_engine: "swiftink",
	embedAdditionalFunctionality: true,
	embedSummary: true,
	embedOutline: true,
	embedKeywords: true,
};

class TranscriptionSettingTab extends PluginSettingTab {
	plugin: Transcription;

	constructor(app: App, plugin: Transcription) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Settings for Obsidian Transcription",
		});

		new Setting(containerEl).setName("General Settings").setHeading();

		new Setting(containerEl)
			.setName("Transcription engine")
			.setDesc("The transcription engine to use")
			.setTooltip(
				"Swiftink is a free cloud based transcription engine (no local set up, additional AI features). Whisper ASR is a self-hosted local transcription engine that uses a Python app (requires local setup).",
			)
			.setClass("transcription-engine-setting")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("swiftink", "Swiftink")
					.addOption("whisper_asr", "Whisper ASR")
					.setValue(this.plugin.settings.transcription_engine)
					.onChange(async (value) => {
						this.plugin.settings.transcription_engine = value;
						await this.plugin.saveSettings();
						// Hide the settings for the other transcription engine
						if (value == "swiftink") {
							containerEl
								.findAll(".swiftink-settings")
								.forEach((element) => {
									element.style.display = "block";
								});
							containerEl
								.findAll(".whisper-asr-settings")
								.forEach((element) => {
									element.style.display = "none";
								});
						} else if (value == "whisper_asr") {
							containerEl
								.findAll(".swiftink-settings")
								.forEach((element) => {
									element.style.display = "none";
								});
							containerEl
								.findAll(".whisper-asr-settings")
								.forEach((element) => {
									element.style.display = "block";
								});
						}
					}),
			);

		new Setting(containerEl)
			.setName("Notice verbosity")
			.setDesc("How granularly notices should be displayed")
			.setTooltip(
				"Verbose will display a notice for every event in the backend. Normal will display a notice for every major event, such as successful transcription or file upload. Silent will not display any notices.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("0", "Silent")
					.addOption("1", "Normal")
					.addOption("2", "Verbose")
					.setValue(this.plugin.settings.verbosity.toString())
					.onChange(async (value) => {
						this.plugin.settings.verbosity = parseInt(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Swiftink Settings")
			.setClass("swiftink-settings")
			.setHeading();

		new Setting(containerEl)
			.setClass("swiftink-settings")
			.setName("Swiftink Account")
			.addButton((bt) => {
				bt.setButtonText("Sign in with Google");
				bt.setClass("swiftink-unauthed-only");
				bt.onClick(async () => {
					this.plugin.supabase.auth.signInWithOAuth({
						provider: "google",
						options: { redirectTo: "obsidian://swiftink_auth" },
					});
				});
			})
			.addButton((bt) => {
				bt.setButtonText("Sign in with GitHub");
				bt.setClass("swiftink-unauthed-only");
				bt.onClick(async () => {
					this.plugin.supabase.auth.signInWithOAuth({
						provider: "github",
						options: { redirectTo: "obsidian://swiftink_auth" },
					});
				});
			})
			.addButton((bt) => {
				bt.setButtonText("Log out");
				bt.setClass("swiftink-authed-only");
				bt.onClick(async () => {
					await this.plugin.supabase.auth.signOut();
					this.plugin.user = null;
					containerEl
						.findAll(".swiftink-unauthed-only")
						.forEach((element) => {
							element.style.display = "block";
						});
					containerEl
						.findAll(".swiftink-authed-only")
						.forEach((element) => {
							element.style.display = "none";
						});
					new Notice("Successfully logged out");
				});
			})
			.addButton((bt) => {
				bt.setButtonText(`Manage ${this.plugin.user?.email}`);
				bt.setClass("swiftink-authed-only");
				bt.setClass("swiftink-manage-account-btn");
				bt.onClick(() => {
					window.open(
						"https://swiftink.io/dashboard/account",
						"_blank",
					);
				});
			});

		new Setting(containerEl)
			.setName("Enable timestamps")
			.setDesc("Add timestamps to the beginning of each line")
			.setClass("swiftink-settings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.timestamps)
					.onChange(async (value) => {
						this.plugin.settings.timestamps = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Timestamp format")
			.setDesc(
				"Your choice of hours, minutes, and/or seconds in the timestamp",
			)
			.setClass("swiftink-settings")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("HH:mm:ss", "HH:mm:ss")
					.addOption("mm:ss", "mm:ss")
					.addOption("ss", "ss")
					.setValue(this.plugin.settings.timestampFormat)
					.onChange(async (value) => {
						this.plugin.settings.timestampFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Embed summary")
			.setDesc("Embed the generated transcription summary in the note")
			.setTooltip(
				"This will only work if you have a Swiftink Pro account",
			)
			.setClass("swiftink-settings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedSummary)
					.onChange(async (value) => {
						this.plugin.settings.embedSummary = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Embed outline")
			.setDesc("Embed the generated trancription outline in the note")
			.setTooltip(
				"This will only work if you have a Swiftink Pro account",
			)
			.setClass("swiftink-settings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedOutline)
					.onChange(async (value) => {
						this.plugin.settings.embedOutline = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Embed keywords")
			.setDesc("Embed the extracted keywords in the note")
			.setTooltip(
				"This will only work if you have a Swiftink Pro account",
			)
			.setClass("swiftink-settings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedKeywords)
					.onChange(async (value) => {
						this.plugin.settings.embedKeywords = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Embed function link")
			.setDesc(
				"(Recommended) Include an embedded link to the transcript function modal in the transcribed note",
			)
			.setTooltip(
				"If you disable this, you will not be able to import your additional transcript data or view the transcript on the Swiftink.io from within Obsidian.",
			)
			.setClass("swiftink-settings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedAdditionalFunctionality)
					.onChange(async (value) => {
						this.plugin.settings.embedAdditionalFunctionality =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Whisper ASR Settings")
			.setClass("whisper-asr-settings")
			.setHeading();

		new Setting(containerEl)
			.setName("Whisper ASR URL")
			.setDesc(
				"The URL of the Whisper ASR server: https://github.com/ahmetoner/whisper-asr-webservice",
			)
			.setClass("whisper-asr-settings")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.whisperASRUrl)
					.setValue(this.plugin.settings.whisperASRUrl)
					.onChange(async (value) => {
						this.plugin.settings.whisperASRUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Advanced Settings").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Enable debug mode to see more console logs")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					}),
			);

		// Swiftnk.io links
		containerEl.createEl("hr");

		const logoLink = containerEl.createEl("a");
		logoLink.href = "https://www.swiftink.io";
		logoLink.style.display = "block";
		logoLink.style.marginLeft = "auto";
		logoLink.style.marginRight = "auto";
		logoLink.style.width = "30%";

		const logo = logoLink.createEl("img");
		logo.src = "https://www.swiftink.io/assets/svg/logos/swiftink.svg";
		logo.alt = "Swiftink Logo";
		logo.style.display = "block";
		logo.style.width = "100%";

		const name = containerEl.createEl("p");
		name.classList.add("swiftink-settings");
		name.innerHTML = "Swiftink.io";
		name.style.textAlign = "center";

		const help = containerEl.createEl("p");
		help.classList.add("swiftink-settings");
		help.innerHTML =
			"Questions? Please see our <a href='https://www.swiftink.io/docs'>Documentation</a> or email us at <a href='mailto:support@swiftnk.io'>support@swiftink.io</a> 🙂";
		help.style.textAlign = "center";
		help.style.fontSize = "0.85em";

		const disclaimer = containerEl.createEl("p");
		disclaimer.classList.add("swiftink-settings");
		disclaimer.innerHTML =
			"By proceeding you agree to our <a href='https://www.swiftink.io/terms'>Terms of Service</a> and <a href='https://www.swiftink.io/privacy'>Privacy Policy</a>.";
		disclaimer.style.textAlign = "center";
		disclaimer.style.fontSize = "0.85em";

		// Logic! (the incredible true story)

		// Initially hide the settings for the other transcription engine
		if (this.plugin.settings.transcription_engine == "swiftink") {
			containerEl.findAll(".swiftink-settings").forEach((element) => {
				element.style.display = "block";
			});
			containerEl.findAll(".whisper-asr-settings").forEach((element) => {
				element.style.display = "none";
			});
		} else if (this.plugin.settings.transcription_engine == "whisper_asr") {
			containerEl.findAll(".swiftink-settings").forEach((element) => {
				element.style.display = "none";
			});
			containerEl.findAll(".whisper-asr-settings").forEach((element) => {
				element.style.display = "block";
			});
		}

		// Initially hide the settings for user auth/unauth based on whether the user is signed in
		if (this.plugin.user == null) {
			containerEl
				.findAll(".swiftink-unauthed-only")
				.forEach((element) => {
					element.style.display = "block";
				});
			containerEl.findAll(".swiftink-authed-only").forEach((element) => {
				element.style.display = "none";
			});
		} else {
			containerEl
				.findAll(".swiftink-unauthed-only")
				.forEach((element) => {
					element.style.display = "none";
				});
			containerEl.findAll(".swiftink-authed-only").forEach((element) => {
				element.style.display = "block";
			});
		}

		// If debug mode is off, hide the dev mode setting
		if (!this.plugin.settings.debug) {
			containerEl.findAll(".dev-mode").forEach((element) => {
				element.style.display = "none";
			});
		} else {
			containerEl.findAll(".dev-mode").forEach((element) => {
				element.style.display = "block";
			});
		}
	}
}

export type { TranscriptionSettings };
export { DEFAULT_SETTINGS, TranscriptionSettingTab };
