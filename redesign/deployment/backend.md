# 后端部署步骤

后端为 Python + FastAPI（`api/app.py`），入口 `main.py`。

## 1. 环境要求

- Python 3.10+
- （可选）uv / pip

## 2. 安装依赖

```bash
# 克隆仓库后，在项目根目录执行
cd D:\projects\daily_stock_analysis

# 方式 A：创建虚拟环境（推荐）
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt

# 方式 B：使用 uv
uv sync
```

## 3. 配置环境变量

```bash
# 复制示例配置
cp .env.example .env   # Windows: copy .env.example .env
```

编辑 `.env`，至少配置：

- **AI 模型**：`ANSPIRE_API_KEYS` / `AIHUBMIX_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` 等（至少一个）
- **数据源**：默认内置 AkShare、Baostock、YFinance 免费源可零配置运行；长期稳定建议配置 `TICKFLOW` / `TUSHARE_TOKEN` 等
- **推送渠道**（可选）：`WECHAT_WEBHOOK_URL` / `FEISHU_WEBHOOK_URL` / `TELEGRAM_BOT_TOKEN` 等

## 4. 启动方式

### 方式 A：本地运行 FastAPI 服务

```bash
# 仅启动 API/Web 服务（前端开发时用这个）
python main.py --serve-only --host 0.0.0.0 --port 8000

# 或旧入口
python webui.py
```

启动后访问：`http://localhost:8000`，API 文档：`http://localhost:8000/docs`

### 方式 B：定时分析模式（不启服务，跑完即退出）

```bash
python main.py            # 正常运行
python main.py --dry-run  # 仅获取数据不分析
python main.py --debug    # 调试模式
```

### 方式 C：Docker 部署

```bash
# FastAPI 服务模式
docker-compose -f ./docker/docker-compose.yml up -d server

# 定时任务模式
docker-compose -f ./docker/docker-compose.yml up -d analyzer
```

端口默认 `8000`，可通过 `.env` 中 `API_PORT` 修改。数据持久化挂载 `data/`、`logs/`、`reports/` 目录。
