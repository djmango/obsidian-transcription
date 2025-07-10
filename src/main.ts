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
    Menu,
    Modal
} from "obsidian";
import { TranscriptionEngine } from "./transcribe";
import { StatusBar } from "./status";
import {
    TranscriptionSettings,
    DEFAULT_SETTINGS,
    TranscriptionSettingTab
} from "./settings";
import { FileLink } from "./fileLink";
import { 
    TranscribableFileSource, 
    ExternalFileSource, 
    UrlFileSource
} from "./types/external-file";


export default class Transcription extends Plugin {
    settings: TranscriptionSettings;
    statusBar: StatusBar;

    public static plugin: Plugin;
    public static children: Array<ChildProcess> = [];
    public transcriptionEngine: TranscriptionEngine;

    private pendingCommand: { file?: TFile; parentFile: TFile } | null = null;
    private ongoingTranscriptionTasks: Array<{
        task: Promise<void>;
        abortController: AbortController;
    }> = [];
    public static transcribeFileExtensions: string[] = [
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

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        // Additional initialization if needed
    }





    // Modify your executePendingCommand method to store the ongoing task
    private async executePendingCommand(pendingCommand: {
        file?: TFile;
        parentFile: TFile;
    }) {
        try {
            if (pendingCommand?.file) {

                const abortController = new AbortController();
                const task = this.transcribeAndWrite(
                    pendingCommand.parentFile,
                    pendingCommand.file,
                    abortController
                );
                this.ongoingTranscriptionTasks.push({
                    task,
                    abortController,
                });
                await task;


            } else {

                const filesToTranscribe = await this.getTranscribeableFiles(
                    pendingCommand.parentFile
                );
                for (const fileToTranscribe of filesToTranscribe) {
                    const abortController = new AbortController();
                    const task = this.transcribeAndWrite(pendingCommand.parentFile, fileToTranscribe, abortController);
                    this.ongoingTranscriptionTasks.push({ task, abortController });
                    await task;
                }

            }


        } catch (error) {
            console.error("Error during transcription process:", error);
        }
    }

    public getTranscribeableFiles = async (file: TFile) => {
        // Get all linked files in the markdown file
        const filesLinked = Object.keys(
            this.app.metadataCache.resolvedLinks[file.path]
        );

        // Now that we have all the files linked in the markdown file, we need to filter them by the file extensions we want to transcribe
        const filesToTranscribe: TFile[] = [];
        for (const linkedFilePath of filesLinked) {
            const linkedFileExtension = linkedFilePath.split(".").pop();
            if (
                linkedFileExtension === undefined ||
                !Transcription.transcribeFileExtensions.includes(
                    linkedFileExtension.toLowerCase()
                )
            ) {
                if (this.settings.debug)
                    console.log(
                        "Skipping " +
                        linkedFilePath +
                        " because the file extension is not in the list of transcribeable file extensions"
                    );
                continue;
            }

            // We now know that the file extension is in the list of transcribeable file extensions
            const linkedFile =
                this.app.vault.getAbstractFileByPath(linkedFilePath);

            // Validate that we are dealing with a file and add it to the list of verified files to transcribe
            if (linkedFile instanceof TFile) filesToTranscribe.push(linkedFile);
            else {
                if (this.settings.debug)
                    console.log("Could not find file " + linkedFilePath);
                continue;
            }
        }
        return filesToTranscribe;
    };

    public async transcribeAndWrite(
        parent_file: TFile,
        file: TFile,
        abortController: AbortController | null
    ) {
        try {

            if (this.settings.debug) console.log("Transcribing " + file.path);

            const transcription =
                await this.transcriptionEngine.getTranscription(file);



            let fileText = await this.app.vault.read(parent_file);
            const fileLinkString = this.app.metadataCache.fileToLinktext(
                file,
                parent_file.path
            );
            const fileLinkStringTagged = `[[${fileLinkString}]]`;

            // Find the file link in the text - try multiple approaches for robustness
            let startReplacementIndex = fileText.indexOf(fileLinkStringTagged);
            
            if (startReplacementIndex === -1) {
                // If fileToLinktext didn't work, try the file path
                const filePathTagged = `[[${file.path}]]`;
                startReplacementIndex = fileText.indexOf(filePathTagged);
                
                if (startReplacementIndex === -1) {
                    // If that didn't work, try just the filename
                    const fileNameTagged = `[[${file.name}]]`;
                    startReplacementIndex = fileText.indexOf(fileNameTagged);
                    
                    if (startReplacementIndex === -1) {
                        // As a last resort, use regex to find a link ending with the filename
                        const escapedFileName = file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`\\[\\[([^\\]]*${escapedFileName})\\]\\]`);
                        const match = fileText.match(regex);
                        if (match) {
                            startReplacementIndex = match.index!;
                        }
                    }
                }
            }

            if (startReplacementIndex === -1) {
                throw new Error(`Could not find link for file ${file.path} in parent file ${parent_file.path}`);
            }

            // Find the end of the link
            const linkEnd = fileText.indexOf(']]', startReplacementIndex);
            if (linkEnd === -1) {
                throw new Error(`Could not find end of link for file ${file.path} in parent file ${parent_file.path}`);
            }

            startReplacementIndex = linkEnd + 2; // Position after the ]]

            if (this.settings.lineSpacing === "single") {
                fileText = [
                    fileText.slice(0, startReplacementIndex),
                    `${transcription}`,
                    fileText.slice(startReplacementIndex),
                ].join(" ");
            } else {
                fileText = [
                    fileText.slice(0, startReplacementIndex),
                    `\n${transcription}`,
                    fileText.slice(startReplacementIndex),
                ].join("");
            }

            //check if abortion signal is aborted

            if (abortController?.signal?.aborted) {
                new Notice(`Transcription of ${file.name} cancelled!`, 5 * 1000);
                return;
            }

            await this.app.vault.modify(parent_file, fileText);
        } catch (error) {
            // First check if 402 is in the error message, if so alert the user that they need to pay

            if (error?.message?.includes("402")) {

                new Notice(
                    "You have exceeded the free tier limits."
                    , 10 * 1000
                );
            } else {
                if (this.settings.debug) console.log(error);
                new Notice(`Error transcribing file: ${error}`, 10 * 1000);
            }
        } finally {
            // Clear the AbortController after completion or cancellation
            abortController = null;
        }
    }

    public async transcribeExternalFile(
        fileSource: TranscribableFileSource,
        abortController: AbortController | null
    ): Promise<string> {
        try {
            if (this.settings.debug) console.log("Transcribing external file: " + fileSource.displayName);

            const transcription = await this.transcriptionEngine.getTranscription(fileSource);

            if (abortController?.signal?.aborted) {
                new Notice(`Transcription of ${fileSource.displayName} cancelled!`, 5 * 1000);
                return "";
            }

            return transcription;
        } catch (error) {
            if (error?.message?.includes("402")) {
                new Notice(
                    "You have exceeded the free tier limits.",
                    10 * 1000
                );
            } else {
                if (this.settings.debug) console.log(error);
                new Notice(`Error transcribing external file: ${error}`, 10 * 1000);
            }
            throw error;
        } finally {
            abortController = null;
        }
    }

    onFileMenu(menu: Menu, file: TFile) {
        const parentFile = this.app.workspace.getActiveFile();

        // Check if the parent file is not null and the file is of a type you want to handle
        if (parentFile instanceof TFile && file instanceof TFile) {
            // Get the file extension
            const fileExtension = file.extension?.toLowerCase();

            // Check if the file extension is in the allowed list
            if (
                fileExtension &&
                Transcription.transcribeFileExtensions.includes(fileExtension)
            ) {
                // Add a new item to the right-click menu
                menu.addItem((item) => {
                    item
                        .setTitle("Transcribe")
                        .setIcon("headphones")
                        .onClick(async () => {


                            // Handle the click event
                            const abortController = new AbortController();
                            const task = this.transcribeAndWrite(
                                parentFile,
                                file,
                                abortController
                            );
                            this.ongoingTranscriptionTasks.push({
                                task,
                                abortController,
                            });
                            await task;
                        });
                });
            }
        }
    }


    async onload() {
        await this.loadSettings();

        Transcription.plugin = this;
        console.log("Loading Obsidian Transcription");
        if (this.settings.debug) console.log("Debug mode enabled");

        this.transcriptionEngine = new TranscriptionEngine(
            this.settings,
            this.app.vault,
            this.statusBar,
            this.app
        );


        if (!Platform.isMobileApp) {
            this.statusBar = new StatusBar(this.addStatusBarItem());
            this.registerInterval(
                window.setInterval(() => this.statusBar.display(), 1000)
            );
        }

        // Register the file-menu event
        this.registerEvent(
            this.app.workspace.on("file-menu", this.onFileMenu.bind(this))
        );

        this.addCommand({
            id: "obsidian-transcription-add-file",
            name: "Add File to Transcription",
            editorCallback: async () => {

                class FileSelectionModal extends Modal {


                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl("h2", { text: "Select files:" });
                        const input = contentEl.createEl("input", {
                            type: "file",
                            attr: { multiple: "" },
                        });
                        contentEl.createEl("br");
                        contentEl.createEl("br");
                        const button = contentEl.createEl("button", { text: "Add file link" });
                        button.addEventListener("click", () => {
                            const fileList = input.files;
                            if (fileList) {
                                const files = Array.from(fileList);
                                let path = ""
                                for (const file of files) {
                                    //     console.log(file)
                                    //@ts-ignore
                                    path = this.app.vault.getResourcePath(file).toString();
                                    //console.log(path.toString())
                                }
                                // this.app.vault.copy

                                // //@ts-ignore
                                // let attachementFolder = this.app.vault.config.attachmentFolderPath;
                                //@ts-ignore
                                const basePath = this.app.vault.adapter.basePath;
                                // console.log(attachementFolder);
                                // console.log(basePath);

                                const fe = new FileLink(
                                    path,
                                    basePath,
                                );

                                files.forEach((file: File) => {
                                    fe.embedFile(file)
                                })
                            }


                        })

                    }
                }
                new FileSelectionModal(this.app).open();
            }




        });



        this.addCommand({
            id: "obsidian-transcription-stop",
            name: "Stop Transcription",
            editorCallback: async () => {
                try {
                    // Check if there is an ongoing transcription task
                    if (this.ongoingTranscriptionTasks.length > 0) {

                        console.log("Stopping ongoing transcription...");

                        // Loop through each ongoing task and signal abort
                        for (const { abortController, task } of this.ongoingTranscriptionTasks) {
                            abortController.abort();
                            await task.catch(() => { }); // Catch any errors during abortion
                        }

                        // Clear the ongoing transcription tasks after completion or cancellation
                        this.ongoingTranscriptionTasks = [];
                    }
                    else {
                        new Notice("No ongoing transcription to stop", 5 * 1000)

                    }
                } catch (error) {
                    console.error("Error stopping transcription:", error);
                }

            },
        });

        this.addCommand({
            id: "obsidian-transcription-transcribe-all-in-view",
            name: "Transcribe all files in view",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                if (view.file === null) return;

                const filesToTranscribe = await this.getTranscribeableFiles(view.file);
                const fileNames = filesToTranscribe.map((file) => file.name).join(", ");
                new Notice(`Files Selected: ${fileNames}`, 5 * 1000);


                {

                    for (const fileToTranscribe of filesToTranscribe) {
                        const abortController = new AbortController();
                        const task = this.transcribeAndWrite(view.file, fileToTranscribe, abortController);
                        this.ongoingTranscriptionTasks.push({ task, abortController });
                        await task;
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

                const filesToTranscribe = await this.getTranscribeableFiles(view.file);

                // Now that we have all the files to transcribe, we can prompt the user to choose which one they want to transcribe

                class FileSelectionModal extends FuzzySuggestModal<TFile> {
                    public transcriptionInstance: Transcription; // Reference to Transcription instance

                    constructor(
                        app: App,
                        transcriptionInstance: Transcription
                    ) {
                        super(app);
                        this.transcriptionInstance = transcriptionInstance;
                    }

                    getItems(): TFile[] {
                        return filesToTranscribe;
                    }

                    getItemText(file: TFile): string {
                        return file.name;
                    }

                    async onChooseItem(file: TFile) {

                        if (view.file === null) return;

                        new Notice(`File Selected: ${file.name}`, 5 * 1000);


                        {
                            const abortController = new AbortController();
                            const task = this.transcriptionInstance.transcribeAndWrite(
                                view.file,
                                file,
                                abortController
                            );
                            this.transcriptionInstance.ongoingTranscriptionTasks.push({
                                task,
                                abortController,
                            });
                            await task;
                        }
                    }
                }

                new FileSelectionModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: "obsidian-transcription-transcribe-external-file",
            name: "Transcribe External File or URL",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                class ExternalFileModal extends Modal {
                    private transcriptionInstance: Transcription;

                    constructor(app: App, transcriptionInstance: Transcription) {
                        super(app);
                        this.transcriptionInstance = transcriptionInstance;
                    }

                    onOpen() {
                        const { contentEl } = this;
                        contentEl.empty();
                        
                        contentEl.createEl("h2", { text: "Transcribe External File or URL" });
                        
                        // File picker section
                        const filePickerContainer = contentEl.createDiv();
                        filePickerContainer.createEl("label", { text: "Select Local File:" });
                        const fileInput = filePickerContainer.createEl("input", {
                            type: "file",
                            attr: { accept: Transcription.transcribeFileExtensions.map(ext => `.${ext}`).join(',') }
                        });
                        fileInput.style.width = "100%";
                        fileInput.style.marginTop = "5px";
                        
                        // URL section
                        const urlContainer = contentEl.createDiv();
                        urlContainer.style.marginTop = "15px";
                        urlContainer.createEl("label", { text: "Or enter URL:" });
                        const urlInput = urlContainer.createEl("input", {
                            type: "text",
                            placeholder: "https://example.com/audio.mp3"
                        });
                        urlInput.style.width = "100%";
                        urlInput.style.marginTop = "5px";
                        
                        const buttonContainer = contentEl.createDiv();
                        buttonContainer.style.marginTop = "20px";
                        buttonContainer.style.textAlign = "center";
                        
                        const transcribeButton = buttonContainer.createEl("button", {
                            text: "Transcribe",
                            cls: "mod-cta"
                        });
                        
                        transcribeButton.addEventListener("click", async () => {
                            const selectedFile = fileInput.files?.[0];
                            const url = urlInput.value.trim();
                            
                            if (!selectedFile && !url) {
                                new Notice("Please select a file or enter a URL", 5 * 1000);
                                return;
                            }
                            
                            if (selectedFile && url) {
                                new Notice("Please select either a file or enter a URL, not both", 5 * 1000);
                                return;
                            }
                            
                            let fileSource: TranscribableFileSource;
                            try {
                                if (selectedFile) {
                                    fileSource = new ExternalFileSource(selectedFile);
                                } else {
                                    fileSource = new UrlFileSource(url);
                                }
                                
                                // Check if file extension is supported
                                if (!Transcription.transcribeFileExtensions.includes(fileSource.extension.toLowerCase())) {
                                    new Notice(`Unsupported file type: ${fileSource.extension}`, 5 * 1000);
                                    return;
                                }
                                
                                this.close();
                                
                                const abortController = new AbortController();
                                const task = this.transcriptionInstance.transcribeExternalFile(fileSource, abortController);
                                this.transcriptionInstance.ongoingTranscriptionTasks.push({
                                    task: task.then(() => {}), // Convert to Promise<void>
                                    abortController,
                                });
                                
                                new Notice(`Starting transcription of ${fileSource.displayName}...`, 3 * 1000);
                                
                                try {
                                    const transcription = await task;
                                    
                                    // Insert transcription at cursor position
                                    if (view.file) {
                                        const cursor = editor.getCursor();
                                        const transcriptionText = `## Transcription of ${fileSource.displayName}\n\n${transcription}\n\n`;
                                        editor.replaceRange(transcriptionText, cursor);
                                        new Notice(`Transcription completed for ${fileSource.displayName}`, 5 * 1000);
                                    }
                                } catch (error) {
                                    new Notice(`Transcription failed: ${error.message}`, 8 * 1000);
                                }
                            } catch (error) {
                                new Notice(`Error: ${error.message}`, 8 * 1000);
                            }
                        });
                    }
                }

                new ExternalFileModal(this.app, this).open();
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


    }

    onunload() {
        if (this.settings.debug)
            console.log("Unloading Obsidian Transcription");
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update the transcription engine settings reference after saving
        if (this.transcriptionEngine) {
            this.transcriptionEngine.settings = this.settings;
        }
    }
}

export { Transcription };
