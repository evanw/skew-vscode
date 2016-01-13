(function() {
  function assert(truth) {
    if (!truth) {
      throw Error('Assertion failed');
    }
  }

  function serverMain() {
    var skew = require('skew').create();
    var connection = server.createConnection(new server.IPCMessageReader(process), new server.IPCMessageWriter(process));

    // The builder handles scheduling asynchronous builds
    var builder = new Builder(skew, connection);

    // Listen to open documents
    var openDocuments = new server.TextDocuments();
    builder.openDocuments = openDocuments;
    openDocuments.listen(connection);
    openDocuments.onDidChangeContent(function(change) {
      builder.buildLater();
    });

    // Grab the workspace when the connection opens
    connection.onInitialize(function(params) {
      builder.workspaceRoot = params.rootPath;
      builder.buildLater();
      return {'capabilities': {'textDocumentSync': openDocuments.syncKind, 'hoverProvider': true, 'definitionProvider': true, 'documentSymbolProvider': true}};
    });

    // Show tooltips on hover
    connection.onHover(function(request) {
      var tooltip = null;
      reportErrors(connection, function() {
        tooltip = computeTooltip(skew, request);
      });
      return tooltip;
    });

    // Support the "go to definition" feature
    connection.onDefinition(function(request) {
      var location = null;
      reportErrors(connection, function() {
        location = computeDefinitionLocation(skew, request);
      });
      return location;
    });

    // Support the "go to symbol" feature
    connection.onDocumentSymbol(function(request) {
      var info = null;
      reportErrors(connection, function() {
        info = computeDocumentSymbols(skew, request);
      });
      return info;
    });

    // Listen to file system changes for *.sk files
    connection.onDidChangeWatchedFiles(function(change) {
      builder.buildLater();
    });
    connection.listen();
  }

  function computeTooltip(skew, request) {
    var absolute = server.Files.uriToFilePath(request.uri);
    var result = skew.tooltipQuery({
      'source': absolute,
      'line': request.position.line,
      'column': request.position.character,
      // Visual Studio Code already includes diagnostics and including
      // them in the results causes each diagnostic to be shown twice
      'ignoreDiagnostics': true
    });

    if (result.tooltip !== null) {
      return {'contents': {'language': 'skew', 'value': result.tooltip}, 'range': convertRange(result.range)};
    }

    return null;
  }

  function computeDefinitionLocation(skew, request) {
    var absolute = server.Files.uriToFilePath(request.uri);
    var result = skew.definitionQuery({'source': absolute, 'line': request.position.line, 'column': request.position.character});

    if (result.definition !== null) {
      return {'uri': 'file://' + result.definition.source.split('\\').join('/').split('/').map(encodeURIComponent).join('/'), 'range': convertRange(result.definition)};
    }

    return null;
  }

  function computeDocumentSymbols(skew, request) {
    var absolute = server.Files.uriToFilePath(request.uri);
    var result = skew.symbolsQuery({'source': absolute});

    if (result.symbols === null) {
      return null;
    }

    var symbols = [];

    for (var i = 0, list = result.symbols, count = list.length; i < count; i = i + 1 | 0) {
      var symbol = in_List.get(list, i);
      var kind = in_StringMap.get(symbolKindMap, symbol.kind, 0);

      if (kind != 0) {
        symbols.push({'name': symbol.name, 'kind': kind, 'location': {'uri': request.uri, 'range': convertRange(symbol.range)}, 'containerName': symbol.parent});
      }
    }

    return symbols;
  }

  function reportErrors(connection, callback) {
    try {
      callback();
    }

    catch (e) {
      var message = (e && e.stack ? e.stack : e) + '';
      connection.console.error('skew: ' + message);
      connection.window.showErrorMessage('skew: ' + message);
    }
  }

  function findAllFiles(root, filter) {
    var files = [];
    var folders = [root];

    while (folders.length != 0) {
      var folder = in_List.takeLast(folders);
      var entries = fs.readdirSync(folder);

      for (var i = 0, count = entries.length; i < count; i = i + 1 | 0) {
        var entry = in_List.get(entries, i);
        var absolute = path.join(folder, entry);

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

  function build(skew, workspaceRoot, openDocuments) {
    var files = findAllFiles(workspaceRoot, function(name) {
      return in_string.endsWith(name, '.sk');
    });
    var inputs = [];

    // Read file contents but check for content in open documents first
    for (var i = 0, count = files.length; i < count; i = i + 1 | 0) {
      var absolute = in_List.get(files, i);
      var document = openDocuments.get('file://' + absolute.split('\\').join('/').split('/').map(encodeURIComponent).join('/'));
      inputs.push({'name': absolute, 'contents': document ? document.getText() : fs.readFileSync(absolute, 'utf8')});
    }

    // Pass the inputs to the compiler for a build
    var result = skew.compile({'target': 'js', 'inputs': inputs, 'stopAfterResolve': true});
    return result.log.diagnostics;
  }

  function convertRange(range) {
    return {'start': {'line': range.start.line, 'character': range.start.column}, 'end': {'line': range.end.line, 'character': range.end.column}};
  }

  function sendDiagnostics(openDocuments, diagnostics, connection) {
    var allDocuments = openDocuments.all();
    var map = Object.create(null);

    for (var i = 0, count = diagnostics.length; i < count; i = i + 1 | 0) {
      var diagnostic = in_List.get(diagnostics, i);
      var absolute = diagnostic.range.source;
      var group = in_StringMap.get(map, absolute, null);

      if (group == null) {
        group = [];
        map[absolute] = group;
      }

      group.push({'severity': diagnostic.kind === 'error' ? server.DiagnosticSeverity.Error : server.DiagnosticSeverity.Warning, 'range': convertRange(diagnostic.range), 'message': diagnostic.text});
    }

    for (var i1 = 0, count1 = allDocuments.length; i1 < count1; i1 = i1 + 1 | 0) {
      var textDocument = in_List.get(allDocuments, i1);
      var absolute1 = server.Files.uriToFilePath(textDocument.uri);
      connection.sendDiagnostics({'uri': textDocument.uri, 'diagnostics': in_StringMap.get(map, absolute1, [])});
    }
  }

  function Builder(skew, connection) {
    this.skew = skew;
    this.connection = connection;
    this.workspaceRoot = null;
    this.openDocuments = null;
    this.timeout = -1;
  }

  Builder.prototype.buildLater = function() {
    var self = this;
    clearTimeout(self.timeout);
    self.timeout = setTimeout(function() {
      reportErrors(self.connection, function() {
        var diagnostics = build(self.skew, self.workspaceRoot, self.openDocuments);
        sendDiagnostics(self.openDocuments, diagnostics, self.connection);
      });
    }, 100);
  };

  var in_string = {};

  in_string.slice1 = function(self, start) {
    assert(0 <= start && start <= self.length);
    return self.slice(start);
  };

  in_string.endsWith = function(self, text) {
    return self.length >= text.length && in_string.slice1(self, self.length - text.length | 0) == text;
  };

  var in_List = {};

  in_List.get = function(self, index) {
    assert(0 <= index && index < self.length);
    return self[index];
  };

  in_List.takeLast = function(self) {
    assert(self.length != 0);
    return self.pop();
  };

  var in_StringMap = {};

  in_StringMap.insert = function(self, key, value) {
    self[key] = value;
    return self;
  };

  in_StringMap.get = function(self, key, defaultValue) {
    var value = self[key];

    // Compare against undefined so the key is only hashed once for speed
    return value !== void 0 ? value : defaultValue;
  };

  var fs = require('fs');
  var path = require('path');
  var server = require('vscode-languageserver');
  var symbolKindMap = in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(Object.create(null), 'OBJECT_CLASS', 5), 'OBJECT_ENUM', 10), 'OBJECT_INTERFACE', 11), 'OBJECT_NAMESPACE', 3), 'OBJECT_WRAPPED', 5), 'FUNCTION_ANNOTATION', 12), 'FUNCTION_CONSTRUCTOR', 9), 'FUNCTION_GLOBAL', 12), 'FUNCTION_INSTANCE', 6), 'VARIABLE_ENUM', 13), 'VARIABLE_GLOBAL', 13), 'VARIABLE_INSTANCE', 8);

  serverMain();
})();
