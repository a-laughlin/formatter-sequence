// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
  commands,
  ExtensionContext,
  window,
  workspace,
  languages,
  TextDocument,
  OutputChannel,
  ConfigurationTarget
} from "vscode";

const EXTENSION_PUBLISHER = "alaughlin";
const EXTENSION_NAME = "formatter-sequence";
const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;

export async function activate(context: ExtensionContext) {
  // Code here is executed once and only once, on the first time the extension is activated
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  const logger = window.createOutputChannel(EXTENSION_NAME);
  logger.appendLine(`Registering "${EXTENSION_ID}" extension`);
  const format = async (
    document: TextDocument,
    formatCommand:'editor.action.formatSelection'|'editor.action.formatDocument'
  ) => {
    const config = workspace.getConfiguration(undefined,{languageId:document.languageId});

    // The below check ensures we set editor.defaultFormatter in the same configuration location that it
    // currently exists so we don't unexpectedly change where the user has their defaultFormatter set.
    // The order of checks goes from the most specific to least specific location.
    // "?? {}" handles the defaultFormatter absent case
    const {
      workspaceLanguageValue,
      workspaceValue,
      workspaceFolderLanguageValue,
      workspaceFolderValue,
      globalLanguageValue
    } = config.inspect('editor.defaultFormatter') ?? {};
    const [configurationTarget, isLanguageSpecific] = (
      typeof workspaceLanguageValue === 'string'        ? [ConfigurationTarget.Workspace, true] :
      typeof workspaceValue === 'string'                ? [ConfigurationTarget.Workspace, false] :
      typeof workspaceFolderLanguageValue === 'string'  ? [ConfigurationTarget.WorkspaceFolder, true] :
      typeof workspaceFolderValue === 'string'          ? [ConfigurationTarget.WorkspaceFolder, false] :
      typeof globalLanguageValue === 'string'           ? [ConfigurationTarget.Global, true] :
      /* typeof globalValue === string|undefined */       [ConfigurationTarget.Global, false]
    );

    const formatters = config.get<string[]>(EXTENSION_NAME,[]);

    // When multiple formatters make changes, only the first formatter's changes are saved, leaving the file dirty. We can detect the intent to save by checking if the document is saved after the first change.  If only one formatter runs, it saves correctly. If 2+ run, the second loop iteration will catch whether it saved on the first run.  There is also a race condition where the isDirty state isn't updated immediately after formatting, so this is a bit hacky, but it seems to work in all cases.
    logger.appendLine(`running ${EXTENSION_NAME} [${formatters.join(', ')}]`);
    let wasSaved = false;
    let wasDirty = false;
    for (const formatter of formatters) {
      await config.update("editor.defaultFormatter", formatter, configurationTarget, isLanguageSpecific);
      // wasSaved needs to be set after updating defaultFormatter because updating it causes enough of a delay for document.isDirty to update.
      wasSaved ||= wasDirty && !document.isDirty;
      await commands.executeCommand(formatCommand);
      await setTimeout(()=>{},0); // wait for document.isDirty to update
      wasDirty ||= document.isDirty;
    };

    // reset defaultFormatter back to "alaughlin.formatter-sequence"
    await config.update("editor.defaultFormatter", EXTENSION_ID, configurationTarget, isLanguageSpecific);
    // logger.appendLine(`document.isDirty: ${document.isDirty} | wasSaved: ${wasSaved}`);
    // logger.appendLine(`document.isDirty: ${document.isDirty} | wasSaved: ${wasSaved}`);
    if(document.isDirty && wasSaved) {
      await commands.executeCommand('workbench.action.files.saveWithoutFormatting');
    }
    return [];
  };

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) { return; }
      logInvalidConfiguration(editor.document, logger);
    }),
    workspace.onDidOpenTextDocument((document) => {
      logInvalidConfiguration(document, logger);
    }),
    languages.registerDocumentFormattingEditProvider("*", {
      async provideDocumentFormattingEdits(document) {
        return await format(document,'editor.action.formatDocument');
      },
    }),
    languages.registerDocumentRangeFormattingEditProvider("*", {
      async provideDocumentRangeFormattingEdits(document) {
        return await format(document,'editor.action.formatSelection');
      },
      async provideDocumentRangesFormattingEdits(document){
        return await format(document,'editor.action.formatSelection');
      },
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}

const logInvalidConfiguration = (
  document: TextDocument,
  logger: OutputChannel
) => {
  // run only on the currently active document, not all open files
  if (document !== window.activeTextEditor?.document) {
    return;
  }
  const config = workspace.getConfiguration(undefined, {
    languageId: document.languageId,
  });
  const editor = config.get<{ defaultFormatter: string }>("editor");
  const msgs: string[] = [];

  if (!editor) {
    // I'm not sure what case this is possible in. It might be possible if you have autosave-after-delay enabled, and you focus a different pane.  Haven't tested that.
    msgs.push(
      `If you're trying to use ${EXTENSION_ID}, try clicking somewhere in the text of the document you want to format in order to set it as the formatting context.`
    );
  }

  const formatters = config.get<string[]>(EXTENSION_NAME,[]);
  const validFormatters = formatters.filter(l=>l!==EXTENSION_ID && l!==EXTENSION_NAME);
  const invalidFormatters = formatters.filter(l=>l===EXTENSION_ID || l===EXTENSION_NAME);
  if(invalidFormatters.length>0){
    msgs.push(
      `${EXTENSION_NAME} cannot run itself. Please remove "${invalidFormatters.join(' & ')}" from "${EXTENSION_NAME}":[${formatters.join(' , ')}]`
    );
  }

  if (validFormatters.length === 0){
    msgs.push(
      `To format language "${document.languageId}" with "${EXTENSION_ID}", please update your settings file to include {"[${document.languageId}]":{"formatter-sequence":['a-formatter-extension', 'another-formatter-extension']}".`
    );
  }

  const {
    globalValue,
    workspaceValue,
    workspaceFolderValue,
    globalLanguageValue,
    workspaceLanguageValue,
    workspaceFolderLanguageValue,
  } = config.inspect("editor.defaultFormatter") ?? {};

  if (
    globalValue !== EXTENSION_ID
    && workspaceValue !== EXTENSION_ID
    && workspaceFolderValue !== EXTENSION_ID
    && globalLanguageValue !== EXTENSION_ID
    && workspaceLanguageValue !== EXTENSION_ID
    && workspaceFolderLanguageValue !== EXTENSION_ID
  ) {
    msgs.push(
      `To format language "${document.languageId}" with "${EXTENSION_ID}", please update your settings file to include {"[${document.languageId}]":{ "editor.defaultFormatter": "${EXTENSION_ID}" }}".`
    );
  }

  if (msgs.length > 0) {
    const msg = msgs.join("\n\n");
    // window.showInformationMessage(msg);
    logger.appendLine(msg);
    // throw new Error(msg);
  }
};
