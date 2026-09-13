# 当前阶段：Issue #91 ESLint React 兼容性本地验收

已核验canonical仓库与main e45490a基线。预设3.2.3-beta.6搭配React插件2.13.0引用6个已移除名称；逐项按上游v2迁移表重命名，完整保留原规则级别与显式选项。通过预设现有tsconfigPath选项提供no-implicit-key所需类型信息，同时保留预设在类型模式下启用的no-leaked-conditional-rendering警告。依赖版本、hook、lint-staged与所有产品源码未改。

9项配置回归验证原预设规则保留、6项迁移实际诊断、Hooks/危险HTML错误级别及合法TSX；36项附件回归通过。实际共享pre-commit拒绝违规TSX并放行合法TSX，未使用任何hook豁免。

全库ESLint完成304文件检查，无fatal，仍有6346错误和16警告；全库typecheck失败，包括shared/types.ts循环类型。附件组件17个格式错误和2个警告留作范围外诊断，未执行该组件自动修复。本轮不声称全库通过。配置变更不影响构建产物，未进行生产构建或部署。

按入口登记的Issue85已授权但未合并候选规则执行普通变更自审。本地测试和diff自审完成，正常提交用于固定候选；未形成远端同步或生产发布授权。详细证据见.local/eslint-91/RESULT.md。
