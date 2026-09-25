# SQL 模型与表/数据迁移机制

> 数据库层单一真源：`src/storage.py`。`src/repositories/` 只封装查询，不定义表结构。

---

## 一、SQL 模型在哪

全部表字段定义集中在 `src/storage.py` 第 90~1298 行，40+ 个 SQLAlchemy 模型类，一个类一张表：

```python
class UserExpectationRecord(Base):
    __tablename__ = 'user_expectations'

    id = Column(Integer, primary_key=True, autoincrement=True)
    target_date = Column(Date, nullable=False, index=True)
    index_direction = Column(String(8), nullable=False)
    ...
    __table_args__ = (
        UniqueConstraint('target_date', name='uix_expectation_target_date'),
        CheckConstraint("index_direction IN ('up', 'flat', 'down')", ...),
    )
```

主要模型分布：

| 行号 | 模型 | 领域 |
|---|---|---|
| 90 | `DatabaseSchemaMigration` | 迁移版本记录表 `schema_migrations` |
| 100 | `StockDaily` | 行情日线 |
| 338 | `AnalysisHistory` | 分析历史 |
| 402/470 | `BacktestResult/Summary` | 回测 |
| 525~703 | `Portfolio*` 系列（9 张） | 持仓/交易/快照 |
| 724~763 | `Conversation*` 系列 | Agent 会话记忆 |
| 1031~1169 | `DecisionSignal*` 系列 | 决策信号 |
| 4357~4488 | `UserExpectation/Outcome/AgentEval` | 预期管理 |

JSON 类字段统一存 `TEXT`（应用层 json.dumps/loads），不依赖数据库 JSON 类型——这是可移植性的关键设计。

---

## 二、迁移机制总览：无 Alembic，启动时自检补齐

本项目**不使用 Alembic 等迁移框架**，采用「ensure 式自检迁移」：每次启动时逐个检查结构是否缺列/缺索引，缺则自动补。用户无需手动跑迁移脚本。

### 启动时序（storage.py:1343~1390）

```
DatabaseManager.__init__（单例，首次访问时触发）
  │
  ├─ create_engine(db_url)                    # db_url 来自 config.get_db_url()（config.py:3682）
  ├─ sessionmaker 绑定引擎
  │
  ├─ Base.metadata.create_all(engine)         # ① 建缺失的新表（幂等）
  │
  ├─ ② 依次执行结构补齐（幂等，每次启动都跑）：
  │     _ensure_llm_usage_telemetry_columns()
  │     _ensure_decision_signal_profile_schema()
  │     _ensure_stock_daily_canonical_id()
  │     _ensure_intelligence_item_scope_values()
  │     _ensure_schema_migration_record()
  │     _ensure_intelligence_items_unique_index()
  │     _ensure_expectation_schema()
  │
  └─ 标记 _initialized = True
```

### 版本记录：`schema_migrations` 表

- 常量 `CURRENT_SCHEMA_VERSION = "2026-06-05-create-all-baseline"`（storage.py:66）
- `_ensure_schema_migration_record`（storage.py:1407）把版本号写入 `schema_migrations` 表，冲突则跳过
- 作用是留痕基线，**不是** Alembic 式的版本链执行器——真正的结构补齐靠 `_ensure_*` 方法的 inspector 检查，不依赖版本号判断

---

## 三、标准迁移模式（模板）

以 `_ensure_decision_signal_profile_schema`（storage.py:1433）为范本，一个迁移方法固定四步：

```python
def _ensure_xxx_schema(self) -> None:
    # ① SQLite 门卫：非 SQLite 引擎直接跳过
    #    （PG/MySQL 依赖 create_all 与模型定义保持一致）
    if not self._is_sqlite_engine:
        return

    # ② inspector 检查目标表/列是否已存在
    inspector = inspect(self._engine)
    if not inspector.has_table(DecisionSignalRecord.__tablename__):
        return                                  # 新装环境由 create_all 直接建全
    existing = {c["name"] for c in inspector.get_columns(...)}

    # ③ 缺列则 ALTER TABLE 补列（容错：并发下 duplicate column 静默吞掉）
    if "decision_profile" not in existing:
        with self._engine.begin() as connection:
            connection.exec_driver_sql(
                f"ALTER TABLE {DecisionSignalRecord.__tablename__} "
                "ADD COLUMN decision_profile VARCHAR(16)"
            )
    # OperationalError → _is_sqlite_duplicate_column_error() 为 True 则忽略（storage.py:2273）

    # ④ 数据回填（如果新列需要从旧数据推导）
    self._backfill_decision_signal_profile_from_metadata()
```

### 数据迁移（回填）模式

需要搬历史数据的迁移（如 `_ensure_stock_daily_canonical_id`，storage.py:1614）在补列后多一步：

```
SELECT id, code FROM stock_daily WHERE canonical_id IS NULL   # 分批
    → 按规则计算新值
    → UPDATE ... WHERE id = ...                                # 逐条/分批更新
```

所有写操作统一走 `_run_write_transaction`（storage.py:2217）：SQLite 锁冲突时按指数退避重试（重试次数/间隔来自配置 `sqlite_write_retry_*`）。

---

## 四、如何新增一个字段（开发者操作手册）

给 `user_expectations` 表加一个新列的完整步骤（全部改动只在 `src/storage.py`）：

1. **模型类加 Column**（字段定义处，如 storage.py:4357 的 `UserExpectationRecord`）：
   ```python
   new_field = Column(String(32))
   ```
2. **新增 `_ensure_user_expectation_new_field` 方法**：按第三节模板写（SQLite 门卫 → inspector 查列 → ALTER TABLE → 可选回填）
3. **在 `__init__` 的 ensure 调用链里注册**（storage.py:1382~1388 处追加一行）
4. **验证**：删掉 `data/stock_analysis.db` 前先备份旧库，启动服务，确认旧库自动补列、新库直接建全；`python -m pytest -m "not network"` 过一遍

新表则更简单：只加模型类即可，`create_all` 启动时自动建。

### 约束

- 迁移必须**幂等**：`_ensure_*` 每次启动都会执行，重复跑不能报错、不能重复回填
- 只做**加列/加索引**级别的演进；改列类型、删列这类 SQLite 不支持的 DDL 需要重建表方案，目前代码库刻意回避了这类迁移
- JSON 结构演进（如 `stock_expectations` 数组内字段变化）不动表结构，在 repo/服务层做新旧格式兼容读取

---

## 五、与换库（PG/MySQL）的关系

迁移机制对多后端预留了接缝，但**不是完整支持**：

| 机制 | SQLite | PG/MySQL |
|---|---|---|
| `create_all` 建新表 | ✅ | ✅ |
| `_ensure_*` 结构补齐 | ✅ 执行 | ❌ 全部直接 `return`（门卫） |
| `sqlite_insert ... on_conflict_do_nothing` | ✅ | 走 else 分支的标准 insert（storage.py:1418） |
| WAL / busy_timeout / 写重试 | ✅ | 不适用 |

即：换 PG/MySQL 时**新装环境可以跑**（create_all 建全表），但**老库升级路径缺失**（ensure 方法不生效，缺列不会自动补）。若要正式支持，需要：

1. 把 `_ensure_*` 里的 `exec_driver_sql("ALTER TABLE ...")` 换成方言无关写法或按方言分支
2. 版本表真正启用为迁移执行器（按 `schema_migrations` 记录决定跑哪些迁移）
3. 处理 `CheckConstraint`、`UniqueConstraint` 在各方言下的语法差异

建议 redesign 阶段保持 SQLite；模型层坚持「JSON 存 TEXT + 纯加列演进」的纪律，未来切换成本最低。
