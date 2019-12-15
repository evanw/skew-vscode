import * as fs from 'fs';
import * as path from 'path';
import * as server from 'vscode-languageserver';
import * as Skew from 'skew';

function reportErrorsFromServer<T>(callback: () => T): T | null {
  try {
    return callback();
  } catch (e) {
    const message = (e && e.stack ? e.stack : e) + '';
    connection.console.error('skew: ' + message);
    connection.window.showErrorMessage('skew: ' + message);
    return null;
  }
}

function findAllFiles(root: string, filter: (entry: string) => boolean) {
  const files = [];
  const folders = [root];

  while (folders.length != 0) {
    const folder = folders.pop()!;

    for (const entry of fs.readdirSync(folder)) {
      const absolute = path.join(folder, entry);

      if (fs.statSync(absolute).isDirectory()) {
        folders.push(absolute);
      }

      else if (filter(entry)) {
        files.push(absolute);
      }
    }
  }

  return files;
}

function gatherInputs(workspaceRoot: string | null, openDocuments: server.TextDocuments): Skew.Source[] {
  const inputs: Skew.Source[] = [];
  const openURIs = new Set<string>();

  // Always include all open documents
  for (const document of openDocuments.all()) {
    openURIs.add(document.uri);
    inputs.push({
      name: document.uri,
      contents: document.getText(),
    });
  }

  // Read file contents for all non-open files
  if (workspaceRoot !== null) {
    for (const absolute of findAllFiles(workspaceRoot, name => name.endsWith('.sk'))) {
      const uri = pathToURI(absolute);
      if (!openURIs.has(uri)) {
        inputs.push({
          name: uri,
          contents: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  }

  return inputs;
}

function build(builder: Builder): readonly Skew.Diagnostic[] {
  return builder.skew.compile({
    target: 'js',
    inputs: gatherInputs(builder.workspaceRoot, builder.openDocuments),
    stopAfterResolve: true,
  }).log.diagnostics;
}

function convertRangeFromServer(range: Skew.Range): server.Range {
  return {
    start: {
      line: range.start.line,
      character: range.start.column,
    },
    end: {
      line: range.end.line,
      character: range.end.column,
    },
  };
}

const allFixes = new Map<string, Map<string, Skew.Fix[]>>();

function diagnosticKey({ severity, range, message }: server.Diagnostic): string {
  return JSON.stringify([severity, range, message]);
}

function sendDiagnostics(openDocuments: server.TextDocuments, diagnostics: readonly Skew.Diagnostic[], connection: server.Connection): void {
  const allDocuments = openDocuments.all();
  const map = new Map<string, server.Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const absolute = diagnostic.range.source;
    let group = map.get(absolute);

    if (group === undefined) {
      group = [];
      map.set(absolute, group);
    }

    const result: server.Diagnostic = {
      severity: diagnostic.kind === 'error' ? server.DiagnosticSeverity.Error : server.DiagnosticSeverity.Warning,
      range: convertRangeFromServer(diagnostic.range),
      message: diagnostic.text,
    };
    group.push(result);

    // Stash the fixes in a map as a hack since VSCode doesn't have a way of embedding fixes with diagnostics
    let fixesMap = allFixes.get(absolute);
    if (fixesMap === undefined) {
      fixesMap = new Map;
      allFixes.set(absolute, fixesMap);
    }
    fixesMap.set(diagnosticKey(result), diagnostic.fixes);
  }

  for (const document of allDocuments) {
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: map.get(document.uri) || [],
    });
  }
}

function pathToURI(absolute: string): string {
  // Convert Windows-style paths to Unix-style paths
  absolute = absolute.split('\\').join('/');

  if (!absolute.startsWith('/')) {
    absolute = '/' + absolute;
  }

  // Encode URI components
  return 'file://' + absolute.split('/').map(encodeURIComponent).join('/');
}

class Builder {
  workspaceRoot: string | null = null;
  private timeout: any;

  constructor(
    public skew: Skew.Compiler,
    public openDocuments: server.TextDocuments,
  ) {
  }

  buildLater(): void {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      reportErrorsFromServer(() => {
        let diagnostics = build(this);
        sendDiagnostics(this.openDocuments, diagnostics, connection);
      });
    }, 100);
  };
}

const symbolKindMap = new Map<Skew.SymbolKind, server.SymbolKind>([
  ['OBJECT_CLASS', server.SymbolKind.Class],
  ['OBJECT_ENUM', server.SymbolKind.Enum],
  ['OBJECT_INTERFACE', server.SymbolKind.Interface],
  ['OBJECT_NAMESPACE', server.SymbolKind.Namespace],
  ['OBJECT_WRAPPED', server.SymbolKind.Class],

  ['FUNCTION_ANNOTATION', server.SymbolKind.Function],
  ['FUNCTION_CONSTRUCTOR', server.SymbolKind.Constructor],
  ['FUNCTION_GLOBAL', server.SymbolKind.Function],
  ['FUNCTION_INSTANCE', server.SymbolKind.Method],

  ['VARIABLE_ENUM_OR_FLAGS', server.SymbolKind.EnumMember],
  ['VARIABLE_GLOBAL', server.SymbolKind.Variable],
  ['VARIABLE_INSTANCE', server.SymbolKind.Field],
]);

const typeNameMap = new Map<Skew.SymbolKind, server.CompletionItemKind>([
  ['PARAMETER_FUNCTION', server.CompletionItemKind.TypeParameter],
  ['PARAMETER_OBJECT', server.CompletionItemKind.TypeParameter],

  ['OBJECT_CLASS', server.CompletionItemKind.Class],
  ['OBJECT_ENUM', server.CompletionItemKind.Class],
  ['OBJECT_FLAGS', server.CompletionItemKind.Class],
  ['OBJECT_GLOBAL', server.CompletionItemKind.Class],
  ['OBJECT_INTERFACE', server.CompletionItemKind.Class],
  ['OBJECT_NAMESPACE', server.CompletionItemKind.Class],
  ['OBJECT_WRAPPED', server.CompletionItemKind.Class],

  ['FUNCTION_ANNOTATION', server.CompletionItemKind.Function],
  ['FUNCTION_CONSTRUCTOR', server.CompletionItemKind.Function],
  ['FUNCTION_GLOBAL', server.CompletionItemKind.Function],
  ['FUNCTION_INSTANCE', server.CompletionItemKind.Function],
  ['FUNCTION_LOCAL', server.CompletionItemKind.Function],

  ['VARIABLE_ARGUMENT', server.CompletionItemKind.Variable],
  ['VARIABLE_ENUM_OR_FLAGS', server.CompletionItemKind.Variable],
  ['VARIABLE_GLOBAL', server.CompletionItemKind.Variable],
  ['VARIABLE_INSTANCE', server.CompletionItemKind.Variable],
  ['VARIABLE_LOCAL', server.CompletionItemKind.Variable],
]);

let completionCache: readonly Skew.Completion[] | null = null;

const skew = Skew.create();
const connection = server.createConnection(new server.IPCMessageReader(process), new server.IPCMessageWriter(process));

// The builder handles scheduling asynchronous builds
const builder = new Builder(skew, new server.TextDocuments());

// Listen to open documents
builder.openDocuments.listen(connection);
builder.openDocuments.onDidChangeContent(() => builder.buildLater());

// Grab the workspace when the connection opens
connection.onInitialize(params => {
  builder.workspaceRoot = params.rootPath ? params.rootPath : null;
  builder.buildLater();
  return {
    capabilities: {
      textDocumentSync: builder.openDocuments.syncKind,
      referencesProvider: true,
      codeActionProvider: true,
      hoverProvider: true,
      renameProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.'],
      },
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
    },
  };
});

// Show tooltips on hover
connection.onHover(request => reportErrorsFromServer(() => {
  const result = skew.tooltipQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
    // Visual Studio Code already includes diagnostics and including
    // them in the results causes each diagnostic to be shown twice
    ignoreDiagnostics: true,
  });

  if (result.tooltip !== null) {
    return {
      contents: { language: 'skew', value: result.tooltip },
      range: result.range === null ? undefined : convertRangeFromServer(result.range),
    };
  }

  return null;
}));

// Support the "go to definition" feature
connection.onDefinition(request => reportErrorsFromServer(() => {
  const result = skew.definitionQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
  });

  if (result.definition !== null) {
    return {
      uri: result.definition.source,
      range: convertRangeFromServer(result.definition),
    };
  }

  return null;
}));

// Support the "go to symbol" feature
connection.onDocumentSymbol(request => reportErrorsFromServer(() => {
  const result = skew.symbolsQuery({
    source: request.textDocument.uri,
  });
  if (result.symbols === null) {
    return null;
  }

  const symbols: server.SymbolInformation[] = [];
  for (const symbol of result.symbols) {
    const kind = symbolKindMap.get(symbol.kind);

    if (kind !== undefined) {
      symbols.push({
        name: symbol.name,
        kind,
        location: {
          uri: request.textDocument.uri,
          range: convertRangeFromServer(symbol.range),
        },
        containerName: symbol.parent === null ? undefined : symbol.parent,
      });
    }
  }

  return symbols;
}));

// Support the "rename symbol" feature
connection.onRenameRequest(request => reportErrorsFromServer(() => {
  const changes: { [name: string]: server.TextEdit[] } = {};
  const result = skew.renameQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
  });
  if (result.ranges === null) {
    return null;
  }

  for (const range of result.ranges) {
    const uri = range.source;
    const list = changes[uri] || (changes[uri] = []);
    list.push({
      range: convertRangeFromServer(range),
      newText: request.newName,
    });
  }

  return { changes };
}));

// Support the "find all references" feature
connection.onReferences(request => reportErrorsFromServer(() => {
  const result = skew.renameQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
  });
  if (result.ranges === null) {
    return null;
  }

  return result.ranges.map(range => ({
    uri: range.source,
    range: convertRangeFromServer(range),
  }));
}));

// Support the code completion feature
connection.onCompletion(request => reportErrorsFromServer(() => {
  const result = skew.completionQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
    target: 'js',
    inputs: gatherInputs(builder.workspaceRoot, builder.openDocuments),
  });
  completionCache = result.completions;

  if (result.range === null || completionCache == null) {
    return null;
  }

  const range = convertRangeFromServer(result.range);
  return completionCache.map<server.CompletionItem>((symbol, i) => ({
    label: symbol.name,
    kind: typeNameMap.get(symbol.kind) || server.CompletionItemKind.Text,
    textEdit: { range, newText: symbol.name },
    data: i,
  }));
}));
connection.onCompletionResolve(request => reportErrorsFromServer(() => {
  const index = request.data | 0;

  if (completionCache != null && index >= 0 && index < completionCache.length) {
    const symbol = completionCache[index];
    let comments: string | undefined;

    // Format comments into paragraphs for documentation
    if (symbol.comments !== null) {
      let wasBlank = false;
      comments = '';

      for (let line of symbol.comments) {
        line = line.trim();

        if (line !== '') {
          comments += wasBlank ? '\n\n' : ' ';
        }

        comments += line;
        wasBlank = line === '';
      }
    }

    return {
      detail: symbol.type,
      documentation: comments,
      label: symbol.name,
    };
  }

  return null;
})!);
connection.onSignatureHelp(request => reportErrorsFromServer(() => {
  const result = skew.signatureQuery({
    source: request.textDocument.uri,
    line: request.position.line,
    column: request.position.character,
  });

  if (result.signature === null || result.arguments === null) {
    return null;
  }

  return {
    signatures: [{
      label: result.signature,
      parameters: result.arguments.map(label => ({ label })),
    }],
    activeSignature: 0,
    activeParameter: result.argumentIndex,
  };
}));

// Support quick fixes
connection.onCodeAction(request => reportErrorsFromServer(() => {
  const commands: server.CodeAction[] = [];

  if (request.context.diagnostics.length > 0) {
    const fixesMap = allFixes.get(request.textDocument.uri);
    if (fixesMap !== undefined) {
      const fixes = fixesMap.get(diagnosticKey(request.context.diagnostics[0]));
      if (fixes !== undefined) {
        // Convert each fix into a code action
        for (const fix of fixes) {
          commands.push({
            title: fix.description,
            kind: server.CodeActionKind.QuickFix,
            command: {
              title: fix.description,
              command: 'skew.applyFix',
              arguments: [request.textDocument.uri.toString(), fix.range, fix.expected, fix.replacement]
            },
          });
        }
      }
    }
  }

  return commands;
}));

// Listen to file system changes for *.sk files
connection.onDidChangeWatchedFiles(() => builder.buildLater());
connection.listen();
