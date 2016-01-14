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
        var diagnostic = context.diagnostics[0];
        var message = diagnostic.message;
        var commands = [];
        var $arguments = [document, diagnostic.range];

        if (message == 'Unnecessary parentheses') {
          commands.push({'title': 'Remove unnecessary parentheses', 'command': 'skew.removeParentheses', 'arguments': $arguments});
        }

        else if (in_string.startsWith(message, 'Unnecessary cast from type')) {
          commands.push({'title': 'Remove unnecessary cast', 'command': 'skew.removeCast', 'arguments': $arguments});
        }

        else if (message == 'Number interpreted as decimal (use the prefix "0o" for octal numbers)') {
          commands.push({'title': 'Remove leading zeros to avoid confusion', 'command': 'skew.removeLeadingZeros', 'arguments': $arguments});
          commands.push({'title': 'Add "0o" to interpret as octal', 'command': 'skew.addOctalPrefix', 'arguments': $arguments});
        }

        return commands;
      }}));
      context.subscriptions.push(vscode.commands.registerCommand('skew.removeParentheses', function(document, range) {
        var text = document.getText(range);

        if (in_string.startsWith(text, '(') && in_string.endsWith(text, ')')) {
          text = in_string.slice2(text, 1, in_string.count(text) - 1 | 0);
          var edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, range, text);
          vscode.workspace.applyEdit(edit);
        }
      }));
      context.subscriptions.push(vscode.commands.registerCommand('skew.removeCast', function(document, range) {
        var text = document.getText(range);

        if (in_string.startsWith(text, 'as ')) {
          var line = document.lineAt(range.start).text;
          var column = line.slice(0, range.start.character).trimRight().length;
          range = new vscode.Range(range.start.line, column, range.end.line, range.end.character);
          var edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, range, '');
          vscode.workspace.applyEdit(edit);
        }
      }));
      context.subscriptions.push(vscode.commands.registerCommand('skew.removeLeadingZeros', function(document, range) {
        var text = document.getText(range);
        var value = +text;

        if (in_string.startsWith(text, '0') && value == value) {
          while (in_string.startsWith(text, '0')) {
            text = in_string.slice1(text, 1);
          }

          var edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, range, text);
          vscode.workspace.applyEdit(edit);
        }
      }));
      context.subscriptions.push(vscode.commands.registerCommand('skew.addOctalPrefix', function(document, range) {
        var text = document.getText(range);
        var value = +text;

        if (value == value) {
          while (in_string.startsWith(text, '0')) {
            text = in_string.slice1(text, 1);
          }

          var edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, range, '0o' + text);
          vscode.workspace.applyEdit(edit);
        }
      }));
    };
  }

  var in_string = {};

  in_string.slice1 = function(self, start) {
    assert(0 <= start && start <= in_string.count(self));
    return self.slice(start);
  };

  in_string.slice2 = function(self, start, end) {
    assert(0 <= start && start <= end && end <= in_string.count(self));
    return self.slice(start, end);
  };

  in_string.startsWith = function(self, text) {
    return in_string.count(self) >= in_string.count(text) && in_string.slice2(self, 0, in_string.count(text)) == text;
  };

  in_string.endsWith = function(self, text) {
    return in_string.count(self) >= in_string.count(text) && in_string.slice1(self, in_string.count(self) - in_string.count(text) | 0) == text;
  };

  in_string.count = function(self) {
    return self.length;
  };

  var path = require('path');
  var vscode = require('vscode');
  var client = require('vscode-languageclient');

  extensionMain();
})();
