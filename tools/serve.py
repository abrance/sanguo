#!/usr/bin/env python3
"""开发用静态服务：加 Cache-Control: no-store。

python3 -m http.server 不发 Cache-Control，浏览器会按启发式缓存 JS，
改完代码刷新还跑旧逻辑（踩过）。这个只多一行头，行为一致。

  python3 tools/serve.py [端口] [根目录]
"""
import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静态文件不刷屏


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 10300
    root = sys.argv[2] if len(sys.argv) > 2 else '.'
    handler = functools.partial(Handler, directory=root)
    with http.server.ThreadingHTTPServer(('0.0.0.0', port), handler) as httpd:
        print(f'→ http://localhost:{port}/  (Ctrl-C 停止)', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
