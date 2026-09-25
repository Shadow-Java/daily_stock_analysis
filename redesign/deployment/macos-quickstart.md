# macOS 快速启动（前后端）

需要两个终端窗口，先启动后端，再启动前端。

## 1. 后端（终端 1）

```bash
cd /Users/liyuanbo/liyb/learning-project-v2/daily_stock_analysis

# 首次运行：建虚拟环境 + 装依赖（已有 .venv 可跳过）
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 启动 API 服务（默认 8000 端口）
python main.py --serve-only --host 0.0.0.0 --port 8000
```

验证：浏览器打开 http://localhost:8000/docs

## 2. 前端（终端 2）

```bash
cd /Users/liyuanbo/liyb/learning-project-v2/daily_stock_analysis/apps/dsa-web

# 首次运行：装依赖（已有 node_modules 可跳过）
npm install

# 启动开发服务器（默认 5173 端口）
npm run dev
```

验证：浏览器打开 http://localhost:5173 （/api 已自动代理到后端 8000）

## 3. 日常启动（环境装好后）

```bash
# 终端 1 —— 后端
cd /Users/liyuanbo/liyb/learning-project-v2/daily_stock_analysis && source .venv/bin/activate && python main.py --serve-only --host 0.0.0.0 --port 8000

# 终端 2 —— 前端
cd /Users/liyuanbo/liyb/learning-project-v2/daily_stock_analysis/apps/dsa-web && npm run dev
```
