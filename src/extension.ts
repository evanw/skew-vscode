import * as path from 'path';
import * as vscode from 'vscode';
import * as client from 'vscode-languageclient';
import * as Skew from 'skew';

function reportErrorsFromExtension(callback: () => void): void {
  try {
    callback();
  } catch (e) {
    const message = (e && e.stack ? e.stack : e) + '';
    console.error('skew: ' + message);
    vscode.window.showErrorMessage('skew: ' + message);
  }
}

function convertRangeFromExtension(range: Skew.Range): vscode.Range {
  // TextDocument.getText() crashes if the range uses duck typing
  return new vscode.Range(range.start.line, range.start.column, range.end.line, range.end.column);
}

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('src', 'server.js'));

  const serverOptions: client.ServerOptions = {
    run: {
      module: serverModule,
      transport: client.TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: client.TransportKind.ipc,
    }
  };

  const clientOptions: client.LanguageClientOptions = {
    documentSelector: ['skew'],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.sk')
    },
  };

  const server = new client.LanguageClient('Skew', serverOptions, clientOptions);
  context.subscriptions.push(server.start());

  context.subscriptions.push(vscode.commands.registerCommand('skew.applyFix', (uri: string, range: Skew.Range, expected: string, replacement: string) => {
    reportErrorsFromExtension(() => {
      const converted = convertRangeFromExtension(range);

      for (const document of vscode.workspace.textDocuments) {
        // Make sure the contents of the document are still what they should be
        if (document.uri.toString() === uri && document.getText(converted) === expected) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, converted, replacement);
          vscode.workspace.applyEdit(edit);
          break;
        }
      }
    });
  }));
};
