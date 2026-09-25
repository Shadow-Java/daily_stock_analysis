# API 调用链路分析

前端 API 层到后端的完整调用链路，覆盖分析任务、历史记录、股票数据三条主链路。

---

## 总体分层结构

```
React Component
  ↓ (Axios)
apps/dsa-web/src/api/*.ts         ← API Client 层
  ↓ (HTTP REST / SSE)
api/v1/endpoints/*.py             ← FastAPI 路由层
  ↓ (Depends 注入)
src/services/*.py                 ← 业务服务层
  ↓
src/storage/ / data_provider/     ← 数据层
```

---

## 基础设施

| 文件 | 作用 |
|------|------|
| `apps/dsa-web/src/api/index.ts` | Axios 实例，baseURL、timeout、401 拦截 |
| `apps/dsa-web/src/api/utils.ts` | `toCamelCase()` — snake_case → camelCase |
| `api/app.py` | FastAPI app 工厂，CORS、Auth 中间件、挂载路由 |
| `api/v1/router.py` | 聚合所有子路由，统一挂载到 `/api/v1` |
| `api/deps.py` | 依赖注入：Config、DatabaseManager、SystemConfigService |
| `server.py` | Uvicorn 入口 |

**Axios 实例配置**（`api/index.ts`）：
```typescript
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})
// Response interceptor: 401 → 跳转登录页
// Error interceptor: 解析结构化 API 错误
```

---

## 1. 股票分析链路

### 1.1 发起分析（同步 / 异步）

```
analysisApi.analyze(data)              apps/dsa-web/src/api/analysis.ts
  → POST /api/v1/analysis/analyze
    → trigger_analysis()               api/v1/endpoints/analysis.py
      ├─ 同步模式 → _handle_sync_analysis()    → 200 + 完整报告
      └─ 异步模式 → _handle_async_analysis_batch()
           → task_queue.submit_tasks_batch()  src/services/task_queue.py
           → 返回 202 + { task_id, status: "pending" }
```

异步模式后续执行：
```
TaskQueue Worker
  → AnalysisService.analyze_stock()    src/services/analysis_service.py
      → data_provider/                 多源数据抓取 + fallback
      → src/core/                      分析编排（技术分析 / LLM）
      → src/reports/                   报告生成
      → src/services/notifier          通知推送（微信 / 飞书 / Telegram …）
      → src/storage/                   持久化到 SQLite
```

### 1.2 轮询任务状态

```
analysisApi.getStatus(taskId)          apps/dsa-web/src/api/analysis.ts
  → GET /api/v1/analysis/status/{taskId}
    → get_analysis_status()            api/v1/endpoints/analysis.py
      ├─ 1. task_queue.get_task(taskId)              内存队列查找
      └─ 2. db_manager.get_analysis_history(query_id) DB fallback（任务已完成或过期）
```

### 1.3 SSE 实时事件流

```
new EventSource('/api/v1/analysis/tasks/stream')
  → task_stream()                      api/v1/endpoints/analysis.py
    → event_generator() async
        → 推送当前 pending 任务（task_created 事件）
        → task_queue.subscribe(event_queue)
        → 实时推送 task_created / task_completed / task_failed
        → 每 30s 推送 heartbeat
```

### 1.4 任务执行流快照

```
analysisApi.getTaskFlow(taskId)
  → GET /api/v1/analysis/tasks/{taskId}/flow
    → get_task_run_flow()              api/v1/endpoints/analysis.py
      → task_queue.get_task(taskId)
        ├─ 完成状态: 从 history DB 加载完整快照
        └─ 进行中: build_task_run_flow_snapshot(task)
```

### 1.5 任务列表

```
analysisApi.getTasks()
  → GET /api/v1/analysis/tasks?status=pending&limit=20
    → get_task_list()                  api/v1/endpoints/analysis.py
      → task_queue.list_all_tasks()   按 status 过滤后返回
```

---

## 2. 历史记录链路

```
historyApi.getList(params)
  → GET /api/v1/history?page=1&limit=20&stock_code=...
    → get_history_list()               api/v1/endpoints/history.py
      → HistoryService.get_history_list()        src/services/history_service.py
        → db_manager.get_analysis_history_paginated()

historyApi.getDetail(recordId)
  → GET /api/v1/history/{recordId}
    → get_history_detail()             api/v1/endpoints/history.py
      → HistoryService.resolve_and_get_detail()
        → db_manager.get_analysis_history()
        → db_manager.get_latest_fundamental_snapshot()
        → 报告结构化组装

historyApi.getMarkdown(recordId)
  → GET /api/v1/history/{recordId}/markdown
    → get_history_markdown()           api/v1/endpoints/history.py
      → HistoryService.get_markdown_report()     模板渲染

historyApi.getNews(recordId)
  → GET /api/v1/history/{recordId}/news
    → get_history_news()               api/v1/endpoints/history.py
      → HistoryService.get_news_intel()

historyApi.getShareImage(recordId)
  → GET /api/v1/history/{recordId}/share-image
    → get_history_share_image()        api/v1/endpoints/history.py
      → HistoryService.generate_share_image()    截图 / 渲染
```

---

## 3. 股票数据链路

### 3.1 图片识别导入

```
stocksApi.extractFromImage(file)
  → POST /api/v1/stocks/extract-from-image   (multipart/form-data)
    → extract_from_image()             api/v1/endpoints/stocks.py
      → 校验 MIME 类型和文件大小
      → extract_stock_codes_from_image(data, content_type)
        → Vision LLM（Gemini / Anthropic / OpenAI）
        → 解析 LLM 响应 → list[{ code, name, confidence }]
```

### 3.2 文件 / 文本解析导入

```
stocksApi.parseImport(file | text)
  → POST /api/v1/stocks/parse-import
    → parse_import()                   api/v1/endpoints/stocks.py
      ├─ 文件输入: parse_import_from_bytes(data, filename)  CSV / Excel
      └─ 文本输入: parse_import_from_text(text)             剪贴板文本
```

### 3.3 自选股列表

```
stocksApi.getWatchlist()
  → GET /api/v1/stocks/watchlist
    → get_watchlist()                  api/v1/endpoints/stocks.py
      → SystemConfigService.get_config()  读取 STOCK_LIST 配置项

stocksApi.addToWatchlist(code)
  → POST /api/v1/stocks/watchlist/add
    → add_to_watchlist()               api/v1/endpoints/stocks.py
      → _write_watchlist_codes(service, updated_codes)
```

### 3.4 行情 / K 线数据

```
stocksApi.getQuote(stockCode)
  → GET /api/v1/stocks/{code}/quote
    → get_stock_quote()                api/v1/endpoints/stocks.py
      → StockService.get_realtime_quote()
        → data_provider/（多源 fallback：AkShare / Tushare / Baostock …）

stocksApi.getHistory(stockCode, period, days)
  → GET /api/v1/stocks/{code}/history?period=daily&days=30
    → get_stock_history()              api/v1/endpoints/stocks.py
      → StockService.get_history_data()
        → data_provider/（K 线数据）
```

---

## 4. 错误处理

**后端统一错误格式**（`api/v1/endpoints/*.py`）：
```python
def api_error(status_code, error_code, message):
    raise HTTPException(
        status_code=status_code,
        detail={"error": error_code, "message": message}
    )

# 示例
api_error(400, "validation_error", "股票代码不能为空")
api_error(409, "duplicate_task",   "股票正在分析中")
api_error(404, "not_found",        "任务不存在或已过期")
api_error(500, "internal_error",   "分析过程发生错误")
```

**前端拦截**（`api/index.ts`）：
```typescript
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) redirect('/login')
    attachParsedApiError(error)   // 解析 detail.error / detail.message
    return Promise.reject(error)
  }
)
```

---

## 5. 端点速查表

| 前端函数 | Method | 路径 | 后端 handler | 终止服务 |
|---------|--------|------|--------------|---------|
| `analysisApi.analyze()` | POST | `/api/v1/analysis/analyze` | `trigger_analysis()` | `AnalysisService` |
| `analysisApi.getStatus()` | GET | `/api/v1/analysis/status/{id}` | `get_analysis_status()` | `TaskQueue` + DB |
| `analysisApi.getTasks()` | GET | `/api/v1/analysis/tasks` | `get_task_list()` | `TaskQueue` |
| SSE EventSource | GET | `/api/v1/analysis/tasks/stream` | `task_stream()` | `TaskQueue.subscribe()` |
| `analysisApi.getTaskFlow()` | GET | `/api/v1/analysis/tasks/{id}/flow` | `get_task_run_flow()` | `TaskQueue` + DB |
| `analysisApi.triggerMarketReview()` | POST | `/api/v1/analysis/market-review` | `trigger_market_review()` | `AnalysisService` |
| `historyApi.getList()` | GET | `/api/v1/history` | `get_history_list()` | `HistoryService` |
| `historyApi.getDetail()` | GET | `/api/v1/history/{id}` | `get_history_detail()` | `HistoryService` |
| `historyApi.getMarkdown()` | GET | `/api/v1/history/{id}/markdown` | `get_history_markdown()` | `HistoryService` |
| `historyApi.getShareImage()` | GET | `/api/v1/history/{id}/share-image` | `get_history_share_image()` | `HistoryService` |
| `historyApi.getNews()` | GET | `/api/v1/history/{id}/news` | `get_history_news()` | `HistoryService` |
| `stocksApi.extractFromImage()` | POST | `/api/v1/stocks/extract-from-image` | `extract_from_image()` | Vision LLM |
| `stocksApi.parseImport()` | POST | `/api/v1/stocks/parse-import` | `parse_import()` | 解析器 |
| `stocksApi.getWatchlist()` | GET | `/api/v1/stocks/watchlist` | `get_watchlist()` | `SystemConfigService` |
| `stocksApi.addToWatchlist()` | POST | `/api/v1/stocks/watchlist/add` | `add_to_watchlist()` | `SystemConfigService` |
| `stocksApi.getQuote()` | GET | `/api/v1/stocks/{code}/quote` | `get_stock_quote()` | `data_provider/` |
| `stocksApi.getHistory()` | GET | `/api/v1/stocks/{code}/history` | `get_stock_history()` | `data_provider/` |

---

## 6. 关键文件路径

**前端 API Client**：
- `apps/dsa-web/src/api/index.ts` — Axios 实例
- `apps/dsa-web/src/api/utils.ts` — 工具函数
- `apps/dsa-web/src/api/analysis.ts` — 分析相关
- `apps/dsa-web/src/api/history.ts` — 历史记录
- `apps/dsa-web/src/api/stocks.ts` — 股票数据

**后端路由**：
- `server.py` — Uvicorn 入口
- `api/app.py` — FastAPI app 工厂
- `api/v1/router.py` — v1 路由聚合
- `api/v1/endpoints/analysis.py` — 分析路由
- `api/v1/endpoints/history.py` — 历史路由
- `api/v1/endpoints/stocks.py` — 股票数据路由
- `api/deps.py` — 依赖注入

**后端业务层**：
- `src/services/analysis_service.py` — 分析编排
- `src/services/history_service.py` — 历史数据访问
- `src/services/task_queue.py` — 异步任务管理
- `src/storage/` — 数据库层（SQLAlchemy + SQLite）
- `data_provider/` — 多源数据抓取（含 fallback 链）
