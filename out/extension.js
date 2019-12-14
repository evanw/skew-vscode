(function() {
  function assert(truth) {
    if (!truth) {
      throw Error('Assertion failed');
    }
  }

  function extensionMain() {
    exports.activate = function(context) {
      var serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
      var serverOptions = {'run': {'module': serverModule, 'transport': client.TransportKind.ipc}, 'debug': {'module': serverModule, 'transport': client.TransportKind.ipc}};
      var clientOptions = {'documentSelector': ['skew'], 'synchronize': {'fileEvents': vscode.workspace.createFileSystemWatcher('**/*.sk')}};
      var server = new client.LanguageClient('Skew', serverOptions, clientOptions);
      context.subscriptions.push(server.start());
      context.subscriptions.push(vscode.languages.registerCodeActionsProvider('skew', {'provideCodeActions': function(document, range, context) {
        var commands = [];
        reportErrorsFromExtension(function() {
          // The only way to transport extra data is by abusing the "code" field
          var diagnostic = context.diagnostics[0];
          var fixes = null;

          try {
            fixes = JSON.parse(diagnostic.code);
          }

          catch (e) {
            return;
          }

          // Convert each fix into a code action
          for (var i = 0, list = fixes, count = list.length; i < count; i = i + 1 | 0) {
            var fix = in_List.get(list, i);
            commands.push({'title': fix.description, 'command': 'skew.applyFix', 'arguments': [document.uri.toString(), fix.range, fix.expected, fix.replacement]});
          }
        });
        return commands;
      }}));
      context.subscriptions.push(vscode.commands.registerCommand('skew.applyFix', function(uri, range, expected, replacement) {
        reportErrorsFromExtension(function() {
          var converted = convertRangeFromExtension(range);

          for (var i = 0, list = vscode.workspace.textDocuments, count = list.length; i < count; i = i + 1 | 0) {
            var document = in_List.get(list, i);

            // Make sure the contents of the document are still what they should be
            if (document.uri.toString() === uri && document.getText(converted) === expected) {
              var edit = new vscode.WorkspaceEdit();
              edit.replace(document.uri, converted, replacement);
              vscode.workspace.applyEdit(edit);
              break;
            }
          }
        });
      }));
    };
  }

  function reportErrorsFromExtension(callback) {
    try {
      callback();
    }

    catch (e) {
      var message = (e && e.stack ? e.stack : e) + '';
      console.error('skew: ' + message);
      vscode.window.showErrorMessage('skew: ' + message);
    }
  }

  function convertRangeFromExtension(range) {
    // TextDocument.getText() crashes if the range uses duck typing
    return new vscode.Range(range.start.line, range.start.column, range.end.line, range.end.column);
  }

  var in_List = {};

  in_List.get = function(self, index) {
    assert(0 <= index && index < self.length);
    return self[index];
  };

  var path = require('path');
  var vscode = require('vscode');
  var client = require('vscode-languageclient');

  extensionMain();
})();
