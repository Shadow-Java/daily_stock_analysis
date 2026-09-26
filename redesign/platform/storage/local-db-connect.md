# local-db-connect — 本地数据库连接指南

> 版本: v0.1 | 日期: 2026-09-25
> 关联: [storage-audit.md](storage-audit.md)（全量表清单）、[storage-migration.md](storage-migration.md)（迁移机制）

本项目默认使用 **SQLite 单文件数据库**，无需安装数据库服务，本地直接连文件即可。

## 连接信息速查

| 项 | 值 |
|---|---|
| 数据库类型 | SQLite（**无用户名、无密码、无主机、无端口**，工具里这些输入框一律留空） |
| 数据库名 | 就是个文件路径：`<仓库根目录>/data/stock_analysis.db`（由 `DATABASE_PATH` 配置，默认 `./data/stock_analysis.db`） |
| 连接方式 | 不走网络，GUI / CLI / JDBC 直接打开该文件即可 |

## 一、数据库位置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_PATH` | `./data/stock_analysis.db` | 见 `.env.example`；相对路径基于**进程启动目录** |
| `SQLITE_WAL_ENABLED` | `true` | WAL 模式（会看到 `-wal`/`-shm` 伴生文件） |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | 写冲突等待上限，超时报 `database is locked` |

连接 URL 格式为 `sqlite:///<绝对路径>`（`src/config.py get_db_url()`），首次初始化服务时会自动建目录、自动 `create_all` 建表。

**注意路径坑**：`DATABASE_PATH` 是相对路径时以运行目录解析。从其它目录启动 `uvicorn`/脚本会在那里生成一个空库，看起来"数据丢了"。建议用绝对路径或在仓库根目录启动。

## 二、sqlite3 CLI（macOS 自带）

```bash
# 仓库根目录下
sqlite3 data/stock_analysis.db

-- 常用命令
.tables                          -- 列出所有表
.schema market_daily_snapshot    -- 查看建表语句
PRAGMA table_info(market_pool_detail_snapshot);   -- 查看字段
SELECT * FROM market_daily_snapshot ORDER BY trade_date DESC LIMIT 5;
.quit
```

只读打开（推荐，避免误写与锁冲突）：

```bash
sqlite3 "file:data/stock_analysis.db?mode=ro"
```

## 三、Python 访问

方式 A — 直接 sqlite3（脚本/快速查询）：

```python
import sqlite3

conn = sqlite3.connect("file:data/stock_analysis.db?mode=ro", uri=True)
rows = conn.execute(
    "SELECT trade_date, sentiment_st, sentiment_trend FROM market_daily_snapshot "
    "ORDER BY trade_date DESC LIMIT 5"
).fetchall()
```

方式 B — 复用项目 `DatabaseManager` 单例（与业务同一路径/配置，可写）：

```python
from src.storage import get_db

db = get_db()
with db.session_scope() as session:
    session.execute(text("SELECT 1"))
```

业务代码请优先走 `src/repositories/` 仓库层，不要绕过仓库直连 SQL 写数据。

## 四、GUI 工具

| 工具 | 连接方式 |
|---|---|
| DB Browser for SQLite | 直接打开 `data/stock_analysis.db` 文件 |
| TablePlus / DataGrip / VS Code SQLite 插件 | 新建 SQLite 连接 → 选同一文件路径 |

服务运行中用 GUI 打开是安全的（WAL 允许读写并发）；只做浏览时建议把工具会话设为只读。若 GUI 里看不到最新数据，通常是 WAL 尚未 checkpoint，在服务空闲时执行 `PRAGMA wal_checkpoint(TRUNCATE);` 后刷新。

### 4.1 IntelliJ IDEA / PyCharm 连接步骤

JetBrains 系（IDEA、PyCharm、DataGrip）内置同一套 Database 工具，直接在 IDEA 里连即可：

1. 打开 Database 工具窗：右侧边栏 **Database** 标签（或 `View → Tool Windows → Database`）
2. 点 **`+` → Data Source → SQLite**
3. 首次使用会提示 **Download missing driver files**，点 Download（自动下载 sqlite-jdbc 驱动）
4. 配置连接（**User / Password / Host / Port 全部留空**——SQLite 是文件库，没有这些概念，"数据库名"就是文件路径）：
   - **File**：选仓库内的 `data/stock_analysis.db`（建议用绝对路径，避免相对路径歧义）
   - 或切到 **URL** 模式直接填：`jdbc:sqlite:/Users/<you>/liyb/learning-project-v2/daily_stock_analysis/data/stock_analysis.db`
5. **Test Connection** → OK 保存
6. 打开查询控制台（数据源上右键 → `New → Query Console`）即可执行 SQL，例如：

```sql
SELECT trade_date, sentiment_st, sentiment_trend
FROM market_daily_snapshot
ORDER BY trade_date DESC
LIMIT 5;
```

注意事项：

- **建议只读**：数据源设置 `Options → Read-only session`（或 Introspect 时保持不动），日常浏览不需要写权限，避免与运行中的服务抢写锁
- **schema 刷新**：服务启动新建表后（如 `market_pool_detail_snapshot`），在数据源上右键 `Refresh` 才会出现在左侧树
- **看不到新数据**：同 §四 的 WAL checkpoint 说明
- **不要在 IDEA 里直接改数据**：业务表写入应走应用与 `src/repositories/`，手改容易绕过校验并造成回放数据失真

## 五、WAL 与备份

- 服务运行时目录下会有三个文件：`stock_analysis.db`、`-wal`（未落盘写入）、`-shm`（共享索引）。**不要单独拷贝 `.db` 文件当备份**，会丢 `-wal` 里的数据。
- 正确备份方式（任选）：

```bash
sqlite3 data/stock_analysis.db ".backup 'backup/stock_analysis_$(date +%F).db'"
# 或
sqlite3 data/stock_analysis.db "VACUUM INTO 'backup/stock_analysis_snapshot.db'"
```

## 六、表速览（情绪/行情相关）

| 表 | 内容 |
|---|---|
| `market_daily_snapshot` | 每日情绪快照（双温度、量能、涨跌比、`overseas_summary` 外盘 JSON 等） |
| `market_limit_ladder_snapshot` | 涨停梯队汇总（含 `blown_rate` 炸板率） |
| `market_pool_detail_snapshot` | 池明细（`pool_type` = limit_up / limit_down / blown） |
| `market_focus_events` / `market_focus_stocks` / `market_focus_sectors` | 焦点事件/个股/板块 |
| `market_tomorrow_focus` | 明日重点 |

全量表清单见 [storage-audit.md](storage-audit.md)。

## 七、常见问题

| 现象 | 原因与处理 |
|---|---|
| `database is locked` | 有长事务/写并发超时；确认没有别的进程持写锁，必要时调大 `SQLITE_BUSY_TIMEOUT_MS` |
| 查到的数据"不见了" | 多半连到了另一个路径的库（相对路径 + 不同启动目录）；用 `PRAGMA database_list;` 确认当前文件 |
| GUI 中新表不显示 | 连接后需刷新 schema；或该库从未被服务初始化过（`create_all` 只在服务启动时执行） |
| 想加字段/加表 | 走模型定义 + [storage-migration.md](storage-migration.md) 的迁移机制，不要手工 `ALTER` 生产库 |
