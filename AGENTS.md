# AGENTS

## Shared toolchain docs

机器、工具链、GitHub、SSH 问题先读 `~/Documents/RooPlayground/README.md`。
项目入口、部署、URL、单文件信息见 `./README.md`。
共享文档只链接，不复制。

## 云端边界

默认只做本地文件/本地提交；没有明确说“上云 / 推送 / 建仓 / 改 Pages”，
不初始化远程、不 push、不上传。

## 项目边界

- 主交付为根目录静态 Web 单页：零构建、零后端、零运行时依赖，保持双击 `index.html` 可用。
- `native/` 为可选 Godot 4 同源实现，不参与 Web 部署。
- 范围仅限单软体 + 重力 + 中心引力 + 边界碰撞 + 鼠标/触摸局部拖拽 + 实时调参。
- 不实现合成玩法、多软体、复杂 UI；不引入前端框架或打包步骤。
- 参数初调用 `tests/physics_test.js` 等数值测试验证，不做自动截图视觉迭代。
- GitHub Pages 配置已存在；没有明确说“推送 / 上云 / 改 Pages”时，不建远程、不 push。

## 开源代码借鉴与许可证

- 复用前必须阅读实际 LICENSE，并核对待复用文件、资源和第三方依赖的许可范围。
- 无 LICENSE 的仓库视为“源码可见、未明确授权”：可研究 README 与算法原理，
  可依据通用物理原理独立实现，但不复制函数、类、代码片段，不做逐行翻译，
  不通过改名或局部改写规避许可，不把其源码作为依赖或合并进本项目。
  `blank0x0/soft-body-sandbox`、`djad04/JellyPhysics` 属于此类。
- 优先参考有明确许可证的实现：`idreesaziz/Gloop`（MIT）、
  `appsinacup/godot-softbody2d`（MIT）、`matsuoka-601/Floaty`（MIT）。
- 若复制或修改 MIT 代码，保留版权与许可声明，并在
  `docs/third-party-notices.md` 记录来源文件与修改内容。
- 独立实现时，仅在 `docs/research-notes.md` 记录参考项目和通用算法，不抄源码。
- 不因仓库采用 MIT 就假设其外部资源也采用 MIT。
