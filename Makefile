PORT ?= 10300

.PHONY: server

# 前台起静态服务：Ctrl-C 停止，再 make server 重开
# 用 tools/serve.py 而不是 -m http.server：带 no-store，改完代码刷新就是新代码
server:
	-@pkill -f "http.server $(PORT)" 2>/dev/null
	-@pkill -f "serve.py $(PORT)" 2>/dev/null
	@sleep 0.2
	@python3 tools/serve.py $(PORT)
