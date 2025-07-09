import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { Transcription } from "./main";

interface TranscriptionSettings {
    timestamps: boolean;
    timestampFormat: string;
    timestampInterval: string; // easier to store as a string and convert to number when needed
    translate: boolean;
    language: string;
    verbosity: number;
    whisperASRUrls: string;
    debug: boolean;
    transcriptionEngine: string;
    lineSpacing: string;
    encode: boolean;
    initialPrompt: string;
    vadFilter: boolean;
    wordTimestamps: boolean;
}

const SUPABASE_URL = "https://vcdeqgrsqaexpnogauly.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZGVxZ3JzcWFleHBub2dhdWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODU2OTM4NDUsImV4cCI6MjAwMTI2OTg0NX0.BBxpvuejw_E-Q_g6SU6G6sGP_6r4KnrP-vHV2JZpAho";

const DEFAULT_SETTINGS: TranscriptionSettings = {
    timestamps: false,
    timestampFormat: "auto",
    timestampInterval: "0",
    translate: false,
    language: "auto",
    verbosity: 1,
    whisperASRUrls: "http://localhost:9000",
    debug: false,
    transcriptionEngine: "whisper_asr",
    lineSpacing: "multi",
    encode: true,
    initialPrompt: "",
    vadFilter: false, // this doesn't seem to do anything in the current version of the Whisper ASR server
    wordTimestamps: false,
};

const LANGUAGES = {
    AFRIKAANS: "af",
    ALBANIAN: "sq",
    AMHARIC: "am",
    ARABIC: "ar",
    ARMENIAN: "hy",
    ASSAMESE: "as",
    AZERBAIJANI: "az",
    BASHKIR: "ba",
    BASQUE: "eu",
    BELARUSIAN: "be",
    BENGALI: "bn",
    BOSNIAN: "bs",
    BRETON: "br",
    BULGARIAN: "bg",
    BURMESE: "my",
    CATALAN: "ca",
    CHINESE: "zh",
    CROATIAN: "hr",
    CZECH: "cs",
    DANISH: "da",
    DUTCH: "nl",
    ENGLISH: "en",
    ESTONIAN: "et",
    FAROESE: "fo",
    FINNISH: "fi",
    FRENCH: "fr",
    GALICIAN: "gl",
    GEORGIAN: "ka",
    GERMAN: "de",
    GREEK: "el",
    GUJARATI: "gu",
    HAITIAN: "ht",
    HAUSA: "ha",
    HEBREW: "he",
    HINDI: "hi",
    HUNGARIAN: "hu",
    ICELANDIC: "is",
    INDONESIAN: "id",
    ITALIAN: "it",
    JAPANESE: "ja",
    JAVANESE: "jv",
    KANNADA: "kn",
    KAZAKH: "kk",
    KOREAN: "ko",
    LAO: "lo",
    LATIN: "la",
    LATVIAN: "lv",
    LINGALA: "ln",
    LITHUANIAN: "lt",
    LUXEMBOURGISH: "lb",
    MACEDONIAN: "mk",
    MALAGASY: "mg",
    MALAY: "ms",
    MALAYALAM: "ml",
    MALTESE: "mt",
    MAORI: "mi",
    MARATHI: "mr",
    MONGOLIAN: "mn",
    NEPALI: "ne",
    NORWEGIAN: "no",
    OCCITAN: "oc",
    PANJABI: "pa",
    PERSIAN: "fa",
    POLISH: "pl",
    PORTUGUESE: "pt",
    PUSHTO: "ps",
    ROMANIAN: "ro",
    RUSSIAN: "ru",
    SANSKRIT: "sa",
    SERBIAN: "sr",
    SHONA: "sn",
    SINDHI: "sd",
    SINHALA: "si",
    SLOVAK: "sk",
    SLOVENIAN: "sl",
    SOMALI: "so",
    SPANISH: "es",
    SUNDANESE: "su",
    SWAHILI: "sw",
    SWEDISH: "sv",
    TAGALOG: "tl",
    TAJIK: "tg",
    TAMIL: "ta",
    TATAR: "tt",
    TELUGU: "te",
    THAI: "th",
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
                "Whisper ASR is a self-hosted local transcription engine that uses a Python app (requires local setup).",
            )
            .setClass("transcription-engine-setting")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("whisper_asr", "Whisper ASR")
                    .setValue(this.plugin.settings.transcriptionEngine)
                    .onChange(async (value) => {
                        this.plugin.settings.transcriptionEngine = value;
                        await this.plugin.saveSettings();
                        this.updateSettingVisibility(".whisper-asr-settings", value === "whisper_asr");
                        this.updateSettingVisibility(".word-timestamps-setting", value === "whisper_asr" && this.plugin.settings.timestamps);
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
            .setName("Language")
            .setDesc("The language to transcribe the audio in")
            .setTooltip("Automatically detected if not specified")
            .addDropdown((dropdown) => {
                dropdown.addOption("auto", "Auto-detect");
                for (const [key, value] of Object.entries(LANGUAGES)) {
                    dropdown.addOption(
                        value,
                        key.charAt(0).toUpperCase() +
                        key.slice(1).toLowerCase(),
                    );
                }
                dropdown.setValue(this.plugin.settings.language);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.language = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Line Spacing")
            .setDesc("Which line spacing mode to use")
            .setTooltip(
                "Defaults to multi-line, as returned by the transcription engine"
            )
            .addDropdown((dropdown) => {
                dropdown.addOption("multi", "Multi-line");
                dropdown.addOption("single", "Single-line");
                dropdown.setValue(this.plugin.settings.lineSpacing);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.lineSpacing = value;
                    await this.plugin.saveSettings();
                });
            });
        
        new Setting(containerEl)
            .setName("Enable timestamps")
            .setDesc("Add timestamps to the beginning of each line")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.timestamps)
                    .onChange(async (value) => {
                        this.plugin.settings.timestamps = value;
                        await this.plugin.saveSettings();
                        this.updateSettingVisibility(".depends-on-timestamps", value);
                        this.updateSettingVisibility(".word-timestamps-setting", this.plugin.settings.transcriptionEngine === "whisper_asr" && value);
                    }),
            );

        new Setting(containerEl)
            .setName("Timestamp format")
            .setDesc(
                "Your choice of hours, minutes, and/or seconds in the timestamp. Auto uses the shortest possible format.",
            )
            .setClass("depends-on-timestamps")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("auto", "Auto")
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
            .setName("Timestamp interval")
            .setDesc("The interval at which to add timestamps, in seconds.")
            .setClass("depends-on-timestamps")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("0", "Off")
                    .addOption("5", "5")
                    .addOption("10", "10")
                    .addOption("15", "15")
                    .addOption("20", "20")
                    .addOption("30", "30")
                    .addOption("60", "60")
                    .setValue(this.plugin.settings.timestampInterval)
                    .onChange(async (value) => {
                        this.plugin.settings.timestampInterval = value;
                        await this.plugin.saveSettings();
                    }),
            );


        new Setting(containerEl)
            .setName("Whisper ASR Settings")
            .setClass("whisper-asr-settings")
            .setHeading();

        new Setting(containerEl)
            .setName("Whisper ASR URLs")
            .setDesc(
                "The URL of the Whisper ASR server: https://github.com/ahmetoner/whisper-asr-webservice. Provide multiple URLs separated by semi-colons in case one is offline or not accessible. Tried in order.",
            )
            .setClass("whisper-asr-settings")
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.whisperASRUrls)
                    .setValue(this.plugin.settings.whisperASRUrls)
                    .onChange(async (value) => {
                        this.plugin.settings.whisperASRUrls = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Encode")
            .setDesc("Encode audio first through ffmpeg")
            .setClass("whisper-asr-settings")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.encode)
                    .onChange(async (value) => {
                        this.plugin.settings.encode = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Initial prompt")
            .setDesc("Model follows the style of the prompt, rather than any instructions contained within. 224 tokens max. More info at https://cookbook.openai.com/examples/whisper_prompting_guide")
            .setClass("whisper-asr-settings")
            .addTextArea((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.initialPrompt)
                    .setValue(this.plugin.settings.initialPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.initialPrompt = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Word timestamps")
            .setDesc("Include timestamps for each word, can get very verbose! Only works if timestamps are enabled.")
            .setClass("word-timestamps-setting")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.wordTimestamps)
                    .onChange(async (value) => {
                        this.plugin.settings.wordTimestamps = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("VAD filter")
            .setDesc("Filter out silence from the audio")
            .setClass("whisper-asr-settings")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.vadFilter)
                    .onChange(async (value) => {
                        this.plugin.settings.vadFilter = value;
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


        // Logic! (the incredible true story)
        this.updateSettingVisibility(".whisper-asr-settings", this.plugin.settings.transcriptionEngine === "whisper_asr");

        this.updateSettingVisibility(".depends-on-timestamps", this.plugin.settings.timestamps);
        this.updateSettingVisibility(".word-timestamps-setting", this.plugin.settings.transcriptionEngine === "whisper_asr" && this.plugin.settings.timestamps);
    }


    /**
     * Update the visibility of settings based on the current settings.
     */
    updateSettingVisibility (classSelector: string, visible: boolean) {
        const { containerEl } = this;
        containerEl
            .findAll(classSelector)
            .forEach((element) => {
                element.style.display = visible ? "block" : "none";
            });
    }
}

export type { TranscriptionSettings };
export {
    DEFAULT_SETTINGS,
    TranscriptionSettingTab,
    SUPABASE_URL,
    SUPABASE_KEY
};
