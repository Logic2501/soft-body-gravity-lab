# 冷归档：Godot 原生测试

这里的 GDScript 测试/探针属于 `native/` 的早期 Godot 实现，不参与 Web 主交付，也不在 `npm test` 中运行。

冷归档原因：

- Web 是主路径；Godot 版仅作可选参考。
- 这些测试依赖 `res://tests/` 路径，移动后不能直接运行，避免误以为它们是活跃测试。
- 历史仍可从本地 Git 恢复；功能清单与日志见 `docs/features.md`。

需要恢复时：

```bash
git log --oneline -- archive/native-godot-tests native/tests
git mv archive/native-godot-tests native/tests
./.tools/Godot.app/Contents/MacOS/Godot --headless --path native --script res://tests/physics_test.gd
```

只在明确修改 `native/` 时恢复；Web 回归使用根目录 `tests/`。
