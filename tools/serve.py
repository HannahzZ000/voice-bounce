"""本地预览服务器：禁用缓存，改完刷新即生效。
用法：python3 tools/serve.py [目录，默认当前目录] [端口，默认 3000]
手机测试需要 HTTPS：另开终端运行 npx -y cloudflared tunnel --url http://localhost:3000
"""
import functools, http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

root = sys.argv[1] if len(sys.argv) > 1 else '.'
port = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
print(f'Serving {root} at http://localhost:{port}/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=root)).serve_forever()
