#!/usr/bin/env python3
import http.server
import socketserver
from http.server import HTTPServer, SimpleHTTPRequestHandler

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == "__main__":
    PORT = 3001
    Handler = NoCacheHTTPRequestHandler
    with HTTPServer(("", PORT), Handler) as httpd:
        print(f"Server running on port {PORT} with NO CACHE headers")
        httpd.serve_forever()