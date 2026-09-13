# Issue #88：仅保留 PDF 官方入口（PENDING）
目标：暂停非PDF站内预览；PDF官方新标签页及全部附件原站下载保留。
阶段：本地实现与验证完成，尚未提交或发布。
基线：main 0c9e6a77376ac01d22d6cf5e865d017eee5b681e。
已完成：附件列表移除非PDF按钮、Reader加载及过期缓存提示；同步浏览器冒烟合同。
未完成：提交与发布；不再推进Mac备用、附件镜像或其他预览方案。
验证：36项定向测试与CF生产构建通过；Tabbit实测7种非PDF无按钮、8个下载链接、PDF新窗口、0relay及0dialog。
边界：合成PDF目标网络失败，未证明官方PDF渲染；原站可能触发下载。
风险：TSX lint仍被既有React规则配置故障阻断；全库app类型诊断仍存在，修改组件无诊断。
审查：普通可逆UI范围收窄，自审；服务端保留实现未改，不启用Mac。
证据入口：.local/attachment-88/pdf-only-*.txt；docs/attachment-preview.md。
下一动作：按授权完成提交发布，不沿用旧hook豁免。
