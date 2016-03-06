(function() {
  var __create = Object.create ? Object.create : function(prototype) {
    return {'__proto__': prototype};
  };

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
      builder.workspaceRoot = params.rootPath ? params.rootPath : null;
      builder.buildLater();
      return {'capabilities': {'textDocumentSync': openDocuments.syncKind, 'hoverProvider': true, 'renameProvider': true, 'definitionProvider': true, 'documentSymbolProvider': true, 'completionProvider': {'resolveProvider': true, 'triggerCharacters': ['.']}, 'signatureHelpProvider': {'triggerCharacters': ['(', ',']}}};
    });

    // Show tooltips on hover
    connection.onHover(function(request) {
      var tooltip = null;
      reportErrorsFromServer(connection, function() {
        tooltip = computeTooltip(skew, request);
      });
      return tooltip;
    });

    // Support the "go to definition" feature
    connection.onDefinition(function(request) {
      var location = null;
      reportErrorsFromServer(connection, function() {
        location = computeDefinitionLocation(skew, request);
      });
      return location;
    });

    // Support the "go to symbol" feature
    connection.onDocumentSymbol(function(request) {
      var info = null;
      reportErrorsFromServer(connection, function() {
        info = computeDocumentSymbols(skew, request);
      });
      return info;
    });

    // Support the "rename symbol" feature
    connection.onRenameRequest(function(request) {
      var edits = null;
      reportErrorsFromServer(connection, function() {
        edits = computeRenameEdits(skew, request);
      });
      return edits;
    });

    // Support the code completion feature
    connection.onCompletion(function(request) {
      var list = null;
      reportErrorsFromServer(connection, function() {
        list = computeCompletions(skew, request, builder);
      });
      return list;
    });
    connection.onCompletionResolve(function(request) {
      var details = null;
      reportErrorsFromServer(connection, function() {
        details = computeCompletionDetails(skew, request);
      });
      return details;
    });
    connection.onSignatureHelp(function(request) {
      var help = null;
      reportErrorsFromServer(connection, function() {
        help = computeSignatureHelp(skew, request);
      });
      return help;
    });

    // Listen to file system changes for *.sk files
    connection.onDidChangeWatchedFiles(function(change) {
      builder.buildLater();
    });
    connection.listen();
  }

  function computeTooltip(skew, request) {
    var result = skew.tooltipQuery({
      'source': request.uri,
      'line': request.position.line,
      'column': request.position.character,
      // Visual Studio Code already includes diagnostics and including
      // them in the results causes each diagnostic to be shown twice
      'ignoreDiagnostics': true
    });

    if (result.tooltip !== null) {
      return {'contents': {'language': 'skew', 'value': result.tooltip}, 'range': convertRangeFromServer(result.range)};
    }

    return null;
  }

  function computeDefinitionLocation(skew, request) {
    var result = skew.definitionQuery({'source': request.uri, 'line': request.position.line, 'column': request.position.character});

    if (result.definition !== null) {
      return {'uri': result.definition.source, 'range': convertRangeFromServer(result.definition)};
    }

    return null;
  }

  function computeDocumentSymbols(skew, request) {
    var result = skew.symbolsQuery({'source': request.uri});

    if (result.symbols === null) {
      return null;
    }

    var symbols = [];

    for (var i = 0, list = result.symbols, count = list.length; i < count; i = i + 1 | 0) {
      var symbol = in_List.get(list, i);
      var kind = in_StringMap.get(symbolKindMap, symbol.kind, 0);

      if (kind != 0) {
        symbols.push({'name': symbol.name, 'kind': kind, 'location': {'uri': request.uri, 'range': convertRangeFromServer(symbol.range)}, 'containerName': symbol.parent});
      }
    }

    return symbols;
  }

  function computeRenameEdits(skew, request) {
    var result = skew.renameQuery({'source': request.textDocument.uri, 'line': request.position.line, 'column': request.position.character});

    if (result.ranges === null) {
      return null;
    }

    var map = __create(null);

    for (var i = 0, list = result.ranges, count = list.length; i < count; i = i + 1 | 0) {
      var range = in_List.get(list, i);
      var uri = range.source;
      var changes = in_StringMap.get(map, uri, null);

      if (changes == null) {
        map[uri] = changes = [];
      }

      changes.push({'range': convertRangeFromServer(range), 'newText': request.newName});
    }

    return {'changes': map};
  }

  function computeCompletions(skew, request, builder) {
    var result = skew.completionQuery({'source': request.uri, 'line': request.position.line, 'column': request.position.character, 'target': 'js', 'inputs': gatherInputs(builder.workspaceRoot, builder.openDocuments)});
    completionCache = result.completions;

    if (result.range === null || completionCache == null) {
      return null;
    }

    var list = [];
    var range = convertRangeFromServer(result.range);

    for (var i = 0, count = completionCache.length; i < count; i = i + 1 | 0) {
      var symbol = in_List.get(completionCache, i);
      list.push({'label': symbol.name, 'kind': in_StringMap.get(typeNameMap, symbol.kind, 'text'), 'textEdit': {'range': range, 'newText': symbol.name}, 'data': i});
    }

    return list;
  }

  function computeCompletionDetails(skew, request) {
    var index = request.data | 0;

    if (completionCache != null && index >= 0 && index < completionCache.length) {
      var symbol = in_List.get(completionCache, index);
      var comments = null;

      // Format comments into paragraphs for documentation
      if (symbol.comments !== null) {
        var lines = symbol.comments.map(function(line) {
          return line.trim();
        });
        var wasBlank = false;
        comments = '';

        for (var i = 0, count = lines.length; i < count; i = i + 1 | 0) {
          var line = in_List.get(lines, i);

          if (line != '') {
            comments += wasBlank ? '\n\n' : ' ';
          }

          comments += line;
          wasBlank = line == '';
        }
      }

      return {'detail': symbol.type, 'documentation': comments};
    }

    return null;
  }

  function computeSignatureHelp(skew, request) {
    var result = skew.signatureQuery({'source': request.uri, 'line': request.position.line, 'column': request.position.character});

    if (result.signature === null) {
      return null;
    }

    return {'signatures': [{'label': result.signature, 'parameters': result.arguments.map(function(name) {
      return {'label': name};
    })}], 'activeSignature': 0, 'activeParameter': result.argumentIndex};
  }

  function reportErrorsFromServer(connection, callback) {
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

  function gatherInputs(workspaceRoot, openDocuments) {
    var inputs = [];
    var openURIs = __create(null);

    // Always include all open documents
    for (var i = 0, list = openDocuments.all(), count = list.length; i < count; i = i + 1 | 0) {
      var document = in_List.get(list, i);
      openURIs[document.uri] = 0;
      inputs.push({'name': document.uri, 'contents': document.getText()});
    }

    // Read file contents for all non-open files
    if (workspaceRoot !== null) {
      for (var i1 = 0, list1 = findAllFiles(workspaceRoot, function(name) {
        return in_string.endsWith(name, '.sk');
      }), count1 = list1.length; i1 < count1; i1 = i1 + 1 | 0) {
        var absolute = in_List.get(list1, i1);

        if (!('file://' + absolute.split('\\').join('/').split('/').map(encodeURIComponent).join('/') in openURIs)) {
          inputs.push({'name': 'file://' + absolute.split('\\').join('/').split('/').map(encodeURIComponent).join('/'), 'contents': fs.readFileSync(absolute, 'utf8')});
        }
      }
    }

    return inputs;
  }

  function build(builder) {
    return builder.skew.compile({'target': 'js', 'inputs': gatherInputs(builder.workspaceRoot, builder.openDocuments), 'stopAfterResolve': true}).log.diagnostics;
  }

  function convertRangeFromServer(range) {
    return {'start': {'line': range.start.line, 'character': range.start.column}, 'end': {'line': range.end.line, 'character': range.end.column}};
  }

  function sendDiagnostics(openDocuments, diagnostics, connection) {
    var allDocuments = openDocuments.all();
    var map = __create(null);

    for (var i = 0, count = diagnostics.length; i < count; i = i + 1 | 0) {
      var diagnostic = in_List.get(diagnostics, i);
      var absolute = diagnostic.range.source;
      var group = in_StringMap.get(map, absolute, null);

      if (group == null) {
        group = [];
        map[absolute] = group;
      }

      group.push({
        'severity': diagnostic.kind === 'error' ? server.DiagnosticSeverity.Error : server.DiagnosticSeverity.Warning,
        'range': convertRangeFromServer(diagnostic.range),
        'message': diagnostic.text,
        // The only way to transport extra data is by abusing the "code" field
        'code': JSON.stringify(diagnostic.fixes)
      });
    }

    for (var i1 = 0, count1 = allDocuments.length; i1 < count1; i1 = i1 + 1 | 0) {
      var document = in_List.get(allDocuments, i1);
      connection.sendDiagnostics({'uri': document.uri, 'diagnostics': in_StringMap.get(map, document.uri, [])});
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
      reportErrorsFromServer(self.connection, function() {
        var diagnostics = build(self);
        sendDiagnostics(self.openDocuments, diagnostics, self.connection);
      });
    }, 100);
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

  var in_string = {};

  in_string.slice1 = function(self, start) {
    assert(0 <= start && start <= self.length);
    return self.slice(start);
  };

  in_string.endsWith = function(self, text) {
    return self.length >= text.length && in_string.slice1(self, self.length - text.length | 0) == text;
  };

  var fs = require('fs');
  var path = require('path');
  var server = require('vscode-languageserver');
  var symbolKindMap = in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(__create(null), 'OBJECT_CLASS', 5), 'OBJECT_ENUM', 10), 'OBJECT_INTERFACE', 11), 'OBJECT_NAMESPACE', 3), 'OBJECT_WRAPPED', 5), 'FUNCTION_ANNOTATION', 12), 'FUNCTION_CONSTRUCTOR', 9), 'FUNCTION_GLOBAL', 12), 'FUNCTION_INSTANCE', 6), 'VARIABLE_ENUM_OR_FLAGS', 13), 'VARIABLE_GLOBAL', 13), 'VARIABLE_INSTANCE', 8);
  var typeNameMap = in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(in_StringMap.insert(__create(null), 'PARAMETER_FUNCTION', 'typeParameterName'), 'PARAMETER_OBJECT', 'typeParameterName'), 'OBJECT_CLASS', 'className'), 'OBJECT_ENUM', 'className'), 'OBJECT_FLAGS', 'className'), 'OBJECT_GLOBAL', 'className'), 'OBJECT_INTERFACE', 'className'), 'OBJECT_NAMESPACE', 'className'), 'OBJECT_WRAPPED', 'className'), 'FUNCTION_ANNOTATION', 'identifier'), 'FUNCTION_CONSTRUCTOR', 'identifier'), 'FUNCTION_GLOBAL', 'identifier'), 'FUNCTION_INSTANCE', 'identifier'), 'FUNCTION_LOCAL', 'identifier'), 'VARIABLE_ARGUMENT', 'parameterName'), 'VARIABLE_ENUM_OR_FLAGS', 'parameterName'), 'VARIABLE_GLOBAL', 'parameterName'), 'VARIABLE_INSTANCE', 'parameterName'), 'VARIABLE_LOCAL', 'parameterName');
  var completionCache = [];

  serverMain();
})();
