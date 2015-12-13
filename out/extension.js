(function() {
  function main() {
    exports.activate = function(context) {
      var serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
      var serverOptions = {'run': {'module': serverModule, 'transport': client.TransportKind.ipc}, 'debug': {'module': serverModule, 'transport': client.TransportKind.ipc}};
      var clientOptions = {'documentSelector': ['skew'], 'synchronize': {'fileEvents': vscode.workspace.createFileSystemWatcher('**/*.sk')}};
      var server = new client.LanguageClient('Skew', serverOptions, clientOptions);
      context.subscriptions.push(server.start());
    };
  }

  var path = require('path');
  var vscode = require('vscode');
  var client = require('vscode-languageclient');

  main();
})();
