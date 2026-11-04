"""Authenticated loopback receiver. Current host only, held in RAM for five seconds."""
from __future__ import annotations
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
from .config import normalize_domain

PORT = 47831

class BrowserBridge:
    def __init__(self, token):
        self.token = token
        self.lock = threading.Lock()
        self.states = {}
        self.server = None
        self.error = ''

    def accept(self, body):
        if not isinstance(body, dict) or body.get('browser') not in ('chrome', 'edge'):
            raise ValueError('invalid browser')
        domain = body.get('domain')
        if domain is not None:
            domain = normalize_domain(domain)
        focused = body.get('focused') is True and body.get('incognito') is not True
        with self.lock:
            self.states[body['browser']] = {'domain': domain if focused else None, 'focused': focused, 'received': time.monotonic()}

    def current(self, browser, changed=0):
        with self.lock:
            state = dict(self.states.get(browser, {}))
        if not state or not state.get('focused') or state['received'] < changed or time.monotonic() - state['received'] > 5:
            return None
        return state.get('domain')

    def connected(self):
        with self.lock:
            return any(time.monotonic() - item['received'] <= 6 for item in self.states.values())

    def start(self, port=PORT):
        bridge = self
        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                # Bound incomplete headers/body reads; a local client cannot
                # keep an idle worker alive indefinitely.
                self.request.settimeout(2.0)
                super().setup()

            def log_message(self, *args):
                pass  # Never log current websites or the authentication header.

            def reply(self, status, body):
                payload = json.dumps(body).encode()
                self.send_response(status)
                origin = self.headers.get('Origin', '')
                if origin.startswith('chrome-extension://'):
                    self.send_header('Access-Control-Allow-Origin', origin)
                    self.send_header('Vary', 'Origin')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(payload)

            def do_OPTIONS(self):
                origin = self.headers.get('Origin', '')
                if not origin.startswith('chrome-extension://'):
                    self.reply(403, {'error': 'forbidden origin'})
                    return
                self.send_response(204)
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
                self.end_headers()

            def authorized(self):
                origin = self.headers.get('Origin', '')
                if origin and not origin.startswith('chrome-extension://'):
                    return False
                host = self.headers.get('Host', '')
                if host not in ('127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port)):
                    return False
                expected = 'Bearer ' + bridge.token
                return hmac.compare_digest(self.headers.get('Authorization', ''), expected)

            def do_GET(self):
                if not self.authorized():
                    self.reply(403, {'error': 'unauthorized'})
                elif self.path in ('/health', '/v1/health'):
                    self.reply(200, {'ok': True, 'version': '1.0.0'})
                else:
                    self.reply(404, {'error': 'not found'})

            def do_POST(self):
                authorized = self.authorized()
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 4096:
                        raise ValueError('size')
                    # Drain only the bounded, declared body before rejecting.
                    # Closing a Windows TCP socket with unread request bytes can
                    # reset the connection and hide its otherwise valid 403.
                    # Unauthorized bytes are never decoded, accepted, or stored.
                    payload = self.rfile.read(length)
                    if len(payload) != length:
                        raise ValueError('incomplete body')
                except (ValueError, TypeError, OSError):
                    self.reply(400 if authorized else 403, {
                        'error': 'invalid payload' if authorized else 'unauthorized'
                    })
                    return
                if not authorized:
                    self.reply(403, {'error': 'unauthorized'})
                    return
                if self.path != '/v1/activity':
                    self.reply(404, {'error': 'not found'})
                    return
                try:
                    bridge.accept(json.loads(payload))
                    self.reply(200, {'ok': True})
                except (ValueError, TypeError, UnicodeError):
                    self.reply(400, {'error': 'invalid payload'})

        self.server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True, name='browser-bridge').start()
        return self.server.server_port

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
