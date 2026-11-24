#!/usr/bin/env python3
"""Ollama gate for the office: agents may only talk to allowed models; deleting, pulling and creating models is blocked."""
import http.client, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

TARGET = os.environ.get('OLLAMA', 'host.docker.internal:11434')
MODELS = set(filter(None, os.environ.get('MODELS', '').split(',')))
READ_ONLY = {'/api/version', '/api/tags', '/v1/models', '/api/ps'}
WITH_MODEL = {'/api/chat', '/api/generate', '/api/show', '/v1/chat/completions'}
MAX_BODY = 64 * 2**20


class Gate(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def deny(self, code, text):
        b = json.dumps({'error': text}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def forward(self, body=None):
        c = http.client.HTTPConnection(TARGET, timeout=1800)
        try:
            headers = {'Content-Type': self.headers.get('Content-Type', 'application/json')}
            c.request(self.command, self.path, body=body, headers=headers)
            r = c.getresponse()
            self.send_response(r.status)
            self.send_header('Content-Type', r.getheader('Content-Type', 'application/json'))
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            while True:
                chunk = r.read1(65536)
                if not chunk:
                    break
                self.wfile.write(b'%x\r\n%s\r\n' % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b'0\r\n\r\n')
        except (OSError, http.client.HTTPException) as e:
            print('gate:', type(e).__name__, e, file=sys.stderr, flush=True)
            self.close_connection = True
        finally:
            c.close()

    def allowed_only(self):
        """Model listings show agents only the models they may use."""
        c = http.client.HTTPConnection(TARGET, timeout=30)
        try:
            c.request('GET', self.path)
            d = json.loads(c.getresponse().read())
        except (OSError, ValueError, http.client.HTTPException):
            return self.deny(502, 'Ollama is not responding')
        finally:
            c.close()
        for key, field in (('models', 'name'), ('data', 'id')):
            if isinstance(d.get(key), list):
                d[key] = [m for m in d[key] if m.get(field) in MODELS]
        b = json.dumps(d).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in READ_ONLY:
            return self.deny(403, 'gate: not allowed')
        if path == '/api/version':
            return self.forward()
        self.allowed_only()

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        if urlsplit(self.path).path not in WITH_MODEL or not 0 < length <= MAX_BODY:
            self.close_connection = True
            return self.deny(403, 'gate: not allowed')
        body = self.rfile.read(length)
        try:
            d = json.loads(body)
        except ValueError:
            return self.deny(400, 'gate: invalid JSON')
        if (d.get('model') or d.get('name')) not in MODELS:
            return self.deny(403, 'gate: model not allowed')
        if 'keep_alive' in d and d['keep_alive'] != 0:
            del d['keep_alive']
            body = json.dumps(d).encode()
        self.forward(body)

    def do_DELETE(self):
        self.close_connection = True
        self.deny(403, 'gate: not allowed')

    do_PUT = do_PATCH = do_DELETE

    def log_message(self, f, *a):
        print(self.address_string(), f % a, file=sys.stderr, flush=True)


ThreadingHTTPServer(('0.0.0.0', 8080), Gate).serve_forever()
