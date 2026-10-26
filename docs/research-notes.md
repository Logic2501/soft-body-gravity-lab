# 开源实现调研与许可证记录

> last_verified: 2026-10-26
> 调研目录：`.research/softbody-research/`（项目内，已 git 忽略，不参与交付）

## 结论

本项目物理与渲染为独立实现，包含根目录静态 Web 版与 `native/` 可选 Godot 版。没有复制、逐行翻译或合并任何参考仓库的源码，也没有把参考仓库作为依赖。

## 许可证核查

| 项目 | commit | 许可证 | 核查文件 | 能否复用代码 |
|---|---|---|---|---|
| `idreesaziz/Gloop` | `aa53ebe` | MIT | `LICENSE` | 可以，需保留版权与许可声明 |
| `blank0x0/soft-body-sandbox` | `aec7c4d` | 未发现 LICENSE | 根目录无 LICENSE 文件 | 不可以；仅研究算法 |
| `matsuoka-601/Floaty` | `898cbcb` | MIT | `LICENSE` | 可以，需保留版权与许可声明 |
| `djad04/JellyPhysics` | `865a584` | 自身代码未发现 LICENSE；内置 Box2D 2.4.1 为 MIT | 根目录无 LICENSE；`box2d-2.4.1/LICENSE` 为 MIT | 自身代码不可以；Box2D 部分需另遵守 MIT |
| `appsinacup/godot-softbody2d` | `7b4c80e` | MIT | `LICENSE` | 可以，需保留版权与许可声明 |

MIT 版权声明（若未来复制或修改对应代码，必须保留）：

- Gloop: `Copyright (c) 2026 Gloop Contributors`
- Floaty: `Copyright (c) 2025 matsuoka-601`
- godot-softbody2d: `Copyright (c) Dragos Daian`
- Box2D 2.4.1: `Copyright (c) 2019 Erin Catto`

当前项目未包含上述项目的代码或资源，因此未复制许可证文本到本项目；如后续引入，需在 `docs/third-party-notices.md` 记录具体文件、修改内容和完整许可。

## 研究内容

### Gloop（MIT）

阅读：`README.md`、`LICENSE`、`scripts/soft_body_blob.gd`、`scripts/physics_tuning_ui.gd`。

- Godot 4.5 / 3D：轮廓顶点 + 中心弹簧 + 内部压力；Euler 速度积分、8 子步进、速度上限。
- 面积压力：Shoelace 面积与目标面积差值推动顶点向外。
- 渲染：Catmull-Rom 插值、曲线细分、拉普拉斯平滑、三角形扇网格。
- 调参：滑块范围与实时参数同步。

借鉴：Catmull-Rom 平滑轮廓、内部面积压力、参数分组和调参 UI 的信息组织。未复制代码；其 3D 网格、着色器和角色控制不适用于本项目。

### soft-body-sandbox（无许可证）

阅读：`README.md`、`src/physics/world.ts`、`src/bodies.ts`。

- Verlet 积分；当前/上一位置隐含速度。
- Gauss-Seidel 位置约束求解；相邻边、隔点弦、中心软辐条。
- Shoelace 面积压力；固定时间步长累加器；墙体位置投影、恢复系数和摩擦。
- 拖动最近质点；释放后保留隐含速度。

借鉴：仅通用算法思想——固定步长、环状拓扑、弯曲约束、面积保持、墙体位置投影、局部抓取。未复制函数、类、变量命名或代码结构，未逐行翻译 TypeScript。

### Floaty（MIT）

阅读：`README.md`、`LICENSE`、`solver.ts`。

- PBD 距离约束与体积/面积约束；子步进；CFL 速度限制；墙体边界。
- 面积约束使用 Shoelace 面积和梯度投影。

借鉴：PBD 位置约束和面积梯度投影的通用数学形式。未使用其流体、WASM、Rust 或 TypeScript 代码。

### JellyPhysics（自身代码无许可证）

阅读：`Readme.md`、`src/jelly.cpp`、`src/jelly.hpp`、`box2d-2.4.1/LICENSE`。

- Box2D 圆形刚体按环排列，用 DistanceJoint 连接，另加 cross links。
- 通过关节频率和阻尼调刚度。

借鉴：仅确认“环状节点 + 距离关节”方向；未复制代码。未采用该方案，因为大量刚体和关节会掩盖质点级形变，且引入 C++/Box2D 依赖。

### godot-softbody2d（MIT）

阅读：`README.md`、`LICENSE`、`addons/` 文件结构。

- 将贴图切分为多个区域，为每区创建 `RigidBody2D` + `CollisionShape2D` + `Joint2D`，用 `Skeleton2D` 形变贴图。
- 适合纹理驱动的软体，节点和关节数量较多。

借鉴：仅了解其区域/关节架构；未复制。未采用，因为本项目需要逐质点施加中心引力并观察轮廓形变，自写质点环更直接、依赖更少。

## 本项目的独立实现依据

- PBD 通用方法：Müller et al., *Position Based Dynamics*。
- 距离约束、Shoelace 面积约束、梯度投影、Gauss-Seidel 迭代、固定时间步长。
- Catmull-Rom 样条和拉普拉斯平滑为通用几何方法。
- Web JavaScript 与 `native/` GDScript 两套实现均为本项目独立编写；未从上述仓库复制或翻译代码。

## 视觉与资源

未复制任何参考仓库的图片、字体、着色器或音频资源。UI 使用系统默认字体，果冻外观由本项目 Canvas/Godot 绘制代码的分层填充和边线生成，不使用高光贴图。
