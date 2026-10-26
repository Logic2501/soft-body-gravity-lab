# Web 测试分层

默认测试只覆盖当前主路径的快速回归；稳定/长时场景按需运行。

```bash
npm test        # 快速物理核心 + 浏览器 UI 冒烟
npm run test:deep  # 额外跑 20s 稳定性、默认参数长跑、可重复性、极端参数
npm run test:ui    # 只跑浏览器 UI
```

维护原则：

- UI 测试从 `window.__softBodyDemo.getDefaults()` 读取默认值，不硬编码参数；调整默认参数时不需要改测试。
- 物理测试使用显式场景参数或不变量断言；稳定长跑放在 `--deep`。
- `src/body_collisions.js` 的段碰撞由物理测试覆盖：分离、最小边缘距离、不回落穿透、切向摩擦。
- 质点数重建与色相序列由物理测试覆盖；UI 测试覆盖对应滑块和每体色相。
- 浏览器测试需要 Chrome；可用 `CHROME_BIN` 指定路径。无截图、无视觉断言。
- UI 测试会启动无头 Chrome 调试端口；不要同时并行跑多个 `ui_test.js`。
- Godot 原生测试已冷归档到 `archive/native-godot-tests/`；只在修改 `native/` 时恢复。
- 修改物理/UI 后至少跑 `npm test`；改动物理模型、碰撞或约束时再跑 `npm run test:deep`。
