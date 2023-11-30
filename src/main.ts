import { ChildProcess } from "child_process";
import {
    Editor,
    MarkdownView,
    Plugin,
    PluginManifest,
    TFile,
    Notice,
    Platform,
    FuzzySuggestModal,
    App,

} from "obsidian";
import { TranscriptionEngine } from "./transcribe";
import { StatusBar } from "./status";
import { createClient, User } from "@supabase/supabase-js";
import {
    TranscriptionSettings,
    DEFAULT_SETTINGS,
    TranscriptionSettingTab,
    SWIFTINK_AUTH_CALLBACK
} from "./settings";

export default class Transcription extends Plugin {
    settings: TranscriptionSettings;
    public static plugin: Plugin;
    public static children: Array<ChildProcess> = [];
    private static transcribeFileExtensions: string[] = [
        "mp3",
        "wav",
        "webm",
        "ogg",
        "flac",
        "m4a",
        "aac",
        "amr",
        "opus",
        "aiff",
        "m3gp",
        "mp4",
        "m4v",
        "mov",
        "avi",
        "wmv",
        "flv",
        "mpeg",
        "mpg",
        "mkv",
    ];
    public transcription_engine: TranscriptionEngine;
    statusBar: StatusBar;


    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        // Additional initialization if needed
    }

    public supabase = createClient(
        "https://auth.swiftink.io",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZGVxZ3JzcWFleHBub2dhdWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODU2OTM4NDUsImV4cCI6MjAwMTI2OTg0NX0.BBxpvuejw_E-Q_g6SU6G6sGP_6r4KnrP-vHV2JZpAho",
        {
            auth: {
                detectSessionInUrl: false,
                autoRefreshToken: true,
                persistSession: true,
            },
        },
    );
    public user: User | null;

    private pendingCommand: { file: TFile | TFile[], parentFile: TFile } | null = null;

    private async executePendingCommand(pendingCommand: { file: TFile | TFile[], parentFile: TFile }) {
        // Additional checks or setup before starting the transcription process

        try {
            const filesToTranscribe = Array.isArray(pendingCommand.file) ? pendingCommand.file : [pendingCommand.file];
            console.log(filesToTranscribe)

            for (const file of filesToTranscribe) {
                await this.authenticateAndTranscribe(file, pendingCommand.parentFile);
                //console.log(`Transcription result for ${file.name}: ${transcription}`);
            }
        } catch (error) {
            console.error("Error during transcription process:", error);
        }
    }

    public async authenticateAndTranscribe(file: TFile, parentFile: TFile) {
        // Check if the user is authenticated
        const session = await this.supabase.auth.getSession().then((res) => {
            return res.data;
        });

        if (!session || !session.session) {
            throw new Error("User not authenticated.");
        }


        // Perform transcription after successful authentication
        await this.transcribeAndWrite(parentFile, file);
    }

    // Define transcribeAndWrite as a class method
    public async transcribeAndWrite(parent_file: TFile, file: TFile) {
        if (this.settings.debug) console.log("Transcribing " + file.path);

        this.transcription_engine
            .getTranscription(file)
            .then(async (transcription) => {
                let fileText = await this.app.vault.read(parent_file);
                const fileLinkString =
                    this.app.metadataCache.fileToLinktext(
                        file,
                        parent_file.path,
                    );
                const fileLinkStringTagged = `[[${fileLinkString}]]`;

                const startReplacementIndex =
                    fileText.indexOf(fileLinkStringTagged) +
                    fileLinkStringTagged.length;

                fileText = [
                    fileText.slice(0, startReplacementIndex),
                    `\n${transcription}`,
                    fileText.slice(startReplacementIndex),
                ].join("");

                await this.app.vault.modify(parent_file, fileText);
            })
            .catch((error) => {
                // First check if 402 is in the error message, if so alert the user that they need to pay
                if (
                    error &&
                    error.message &&
                    error.message.includes("402")
                ) {
                    new Notice(
                        "You have exceeded the free tier. Please upgrade to a paid plan at swiftink.io/pricing to continue transcribing files. Thanks for using Swiftink!",
                        10000,
                    );
                } else {
                    if (this.settings.debug) console.log(error);
                    new Notice(`Error transcribing file: ${error}`, 10000);
                }
            });
    }



    async onload() {
        await this.loadSettings();

        Transcription.plugin = this;
        console.log("Loading Obsidian Transcription");
        if (this.settings.debug) console.log("Debug mode enabled");

        this.transcription_engine = new TranscriptionEngine(
            this.settings,
            this.app.vault,
            this.statusBar,
            this.supabase,
            this.app
        );

        // Prompt the user to sign in if the have Swiftink selected and are not signed in
        if (this.settings.transcription_engine == "swiftink") {
            this.user = await this.supabase.auth.getUser().then((res) => {
                return res.data.user || null;
            });
            if (this.user == null) {
                // First try setting the access token and refresh token from the settings
                if (this.settings.debug)
                    console.log(
                        "Trying to set access token and refresh token from settings",
                    );
                if (
                    this.settings.swiftink_access_token != null &&
                    this.settings.swiftink_refresh_token != null
                ) {
                    await this.supabase.auth.setSession({
                        access_token: this.settings.swiftink_access_token,
                        refresh_token: this.settings.swiftink_refresh_token,
                    });
                    this.user = await this.supabase.auth
                        .getUser()
                        .then((res) => {
                            return res.data.user || null;
                        });
                }

                // If the user is still null, prompt them to sign in

                if (this.user == null) {
                    const noticeContent = document.createDocumentFragment();

                    // Create the text node
                    const textNode = document.createTextNode("Transcription: You are signed out. Please ");

                    // Create the hyperlink
                    const signInLink = document.createElement('a');
                    //signInLink.href = SWIFTINK_AUTH_CALLBACK;
                    signInLink.target = '_blank';
                    signInLink.textContent = 'Sign In';

                    // Append the text and link to the document fragment
                    noticeContent.appendChild(textNode);
                    noticeContent.appendChild(signInLink);

                    // Create the notice with the content
                    const notice = new Notice(noticeContent, 16 * 1000);
                    notice.noticeEl.addEventListener('click', () => {
                        window.open(SWIFTINK_AUTH_CALLBACK, '_blank');
                    });
                }



            }
        }

        if (!Platform.isMobileApp) {
            this.statusBar = new StatusBar(this.addStatusBarItem());
            this.registerInterval(
                window.setInterval(() => this.statusBar.display(), 1000),
            );
        }

        const getTranscribeableFiles = (file: TFile) => {
            // Get all linked files in the markdown file
            const filesLinked = Object.keys(
                this.app.metadataCache.resolvedLinks[file.path],
            );

            // Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
            const filesToTranscribe: TFile[] = [];
            for (const linkedFilePath of filesLinked) {
                const linkedFileExtension = linkedFilePath.split(".").pop();
                if (
                    linkedFileExtension === undefined ||
                    !Transcription.transcribeFileExtensions.includes(
                        linkedFileExtension.toLowerCase(),
                    )
                ) {
                    if (this.settings.debug)
                        console.log(
                            "Skipping " +
                            linkedFilePath +
                            " because the file extension is not in the list of transcribeable file extensions",
                        );
                    continue;
                }

                // We now know that the file extension is in the list of transcribeable file extensions
                const linkedFile =
                    this.app.vault.getAbstractFileByPath(linkedFilePath);

                // Validate that we are dealing with a file and add it to the list of verified files to transcribe
                if (linkedFile instanceof TFile)
                    filesToTranscribe.push(linkedFile);
                else {
                    if (this.settings.debug)
                        console.log("Could not find file " + linkedFilePath);
                    continue;
                }
            }
            return filesToTranscribe;
        };


        this.addCommand({
            id: "obsidian-transcription-transcribe-all-in-view",
            name: "Transcribe all files in view",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                if (view.file === null) return;

                if (this.user == null) {

                    this.pendingCommand = {
                        file: getTranscribeableFiles(view.file),
                        parentFile: view.file,
                    };

                    // Redirect to sign-in
                    window.open(SWIFTINK_AUTH_CALLBACK, '_blank');
                    if (Array.isArray(this.pendingCommand.file)) {
                        const fileNames = this.pendingCommand.file.map(file => file.name).join(", ");
                        new Notice(`Files Selected: ${fileNames}`, 5000);
                    }
                }
                else {
                    const filesToTranscribe = getTranscribeableFiles(view.file);
                    const fileNames = filesToTranscribe.map(file => file.name).join(", ");
                    new Notice(
                        `Files Selected: ${fileNames}`,
                        5000,
                    );

                    // Now that we have all the files to transcribe, we can transcribe them
                    for (const fileToTranscribe of filesToTranscribe) {
                        this.transcribeAndWrite(view.file, fileToTranscribe);
                    }
                }

            },
        });

        this.addCommand({
            id: "obsidian-transcription-transcribe-specific-file-in-view",
            name: "Transcribe file in view",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                // Get the current filepath
                if (view.file === null) return;

                const filesToTranscribe = getTranscribeableFiles(view.file);

                // Now that we have all the files to transcribe, we can prompt the user to choose which one they want to transcribe

                class FileSelectionModal extends FuzzySuggestModal<TFile> {

                    public transcriptionInstance: Transcription; // Reference to Transcription instance

                    constructor(app: App, transcriptionInstance: Transcription) {
                        super(app);
                        this.transcriptionInstance = transcriptionInstance;
                    }

                    getItems(): TFile[] {
                        return filesToTranscribe;
                    }

                    getItemText(file: TFile): string {
                        return file.name;
                    }

                    onChooseItem(file: TFile) {
                        if (view.file === null) return;
                        new Notice(`File Selected: ${file.name}`, 5000);
                        if (this.transcriptionInstance.user == null) {
                            this.transcriptionInstance.pendingCommand = {
                                file: file,
                                parentFile: view.file,
                            };

                            // Redirect to sign-in
                            window.open(SWIFTINK_AUTH_CALLBACK, '_blank');

                        } else {
                            this.transcriptionInstance.transcribeAndWrite(view.file, file);
                        }

                    }
                }

                new FileSelectionModal(this.app, this).open();

            },
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

        this.registerObsidianProtocolHandler(
            "swiftink_auth",
            async (callback) => {
                const params = new URLSearchParams(callback.hash);
                const access_token = params.get("access_token");
                const refresh_token = params.get("refresh_token");

                if (!access_token || !refresh_token) {
                    new Notice(
                        "Transcription: Error authenticating with Swiftink.io",
                    );
                    return;
                }

                await this.supabase.auth.setSession({
                    access_token: access_token,
                    refresh_token: refresh_token,
                });
                this.user = await this.supabase.auth.getUser().then((res) => {
                    return res.data.user || null;
                });
                new Notice("Successfully authenticated with Swiftink.io");

                // Save to settings
                this.settings.swiftink_access_token = access_token;
                this.settings.swiftink_refresh_token = refresh_token;
                await this.saveSettings();

                // Show the settings for user auth/unauth based on whether the user is signed in
                if (this.user == null) {
                    document
                        .querySelectorAll(".swiftink-unauthed-only")
                        .forEach((element) => {
                            element.setAttribute(
                                "style",
                                "display: block !important",
                            );
                        });
                    document
                        .querySelectorAll(".swiftink-authed-only")
                        .forEach((element) => {
                            element.setAttribute(
                                "style",
                                "display: none !important",
                            );
                        });
                } else {
                    document
                        .querySelectorAll(".swiftink-unauthed-only")
                        .forEach((element) => {
                            element.setAttribute(
                                "style",
                                "display: none !important",
                            );
                        });
                    document
                        .querySelectorAll(".swiftink-authed-only")
                        .forEach((element) => {
                            element.setAttribute(
                                "style",
                                "display: block !important",
                            );
                        });
                    // Also set the user's email in the settings tab
                    document
                        .querySelectorAll(".swiftink-manage-account-btn")
                        .forEach((element) => {
                            element.innerHTML = `Manage ${this.user?.email}`;
                        });
                }

                // Execute the pending command if there is one
                if (this.pendingCommand) {
                    await this.executePendingCommand(this.pendingCommand);
                    this.pendingCommand = null; // Reset pending command after execution
                }

                return;
            },
        );

        this.registerObsidianProtocolHandler(
            "swiftink_transcript_functions",
            async (callback) => {
                const id = callback.id;
                console.log(id);

                const functions = [
                    "View on Swiftink.io",
                    // "Delete from Swiftink.io",
                    // "Download .txt",
                    // "Download .srt",
                    // "Copy text to clipboard",
                    // "Copy summary to clipboard",
                    // "Copy outline to clipboard",
                    // "Copy keywords to clipboard",
                ];

                class SwiftinkTranscriptFunctionsModal extends FuzzySuggestModal<string> {
                    getItems(): string[] {
                        return functions;
                    }

                    getItemText(function_name: string): string {
                        return function_name;
                    }

                    onChooseItem(function_name: string) {
                        // new Notice(`Running ${function_name} on ${id}`);
                        if (function_name == "View on Swiftink.io") {
                            window.open(
                                "https://swiftink.io/dashboard/",
                                "_blank",
                            );
                        }
                    }
                }

                new SwiftinkTranscriptFunctionsModal(this.app).open();
            },
        );
    }

    onunload() {
        if (this.settings.debug)
            console.log("Unloading Obsidian Transcription");
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData(),
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }


}

export { Transcription };