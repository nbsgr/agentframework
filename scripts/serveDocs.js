import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);

var PORT = 3000;
var docsPath = path.join(__dirname, '..', 'docs', 'index.html');

var server = http.createServer(function(req, res) {
  fs.readFile(docsPath, function(err, content) {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading documentation');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
});

server.listen(PORT, function() {
  console.log('🤖 CodeRun Agents SDK Documentation Server running at http://localhost:' + PORT);
});
