# 前端部署步骤

前端位于 `apps/dsa-web`，技术栈：React 19 + Vite 7 + TypeScript + TailwindCSS 4。

另有桌面端 `apps/dsa-desktop`（Electron），按需构建。

## 1. 环境要求

- Node.js >= 20.19 且 < 27
- npm >= 10

## 2. 安装依赖

```bash
cd apps/dsa-web
npm install
```

## 3. 开发模式

```bash
npm run dev
```

- 开发服务器运行在 `http://localhost:5173`（host 0.0.0.0，允许局域网/公网访问）
- 已配置代理：`/api` 请求自动转发到 `http://127.0.0.1:8000`，因此需先按 `backend.md` 启动后端

## 4. 生产构建

```bash
npm run build
```

- 构建产物输出到项目根目录的 `static/` 文件夹（见 `vite.config.ts` 的 `outDir`）
- 后端 FastAPI 会自动托管 `static/` 目录，构建完成后直接访问后端端口（默认 `http://localhost:8000`）即可，无需单独部署前端静态服务

如需覆盖后端内置静态资源（Docker 场景），可挂载：

```yaml
volumes:
  - ../static:/app/static:ro
```

## 5. 质量检查（可选）

```bash
npm run lint        # ESLint
npm run test        # Vitest 单元测试
npm run test:smoke  # Playwright 冒烟测试
```

## 6. 桌面端（可选）

```bash
cd apps/dsa-desktop
npm install
npm run build   # 详见 apps/dsa-desktop/package.json scripts
```
