# 当前阶段：Issue #88 PDF官方入口（PENDING）

用户明确暂停非PDF附件预览及其他替代方案，仅保留PDF官方URL新标签页查看和所有附件原站下载。本地组件已移除Reader依赖与非PDF预览按钮；不会从附件列表触发解析、缓存或relay。服务端保留实现未改，Mac备用服务不启用。

验证：36项定向测试、CF_PAGES生产构建通过；浏览器冒烟脚本语法和lint通过；Tabbit在当前构建实测7个非PDF静态名称、0非PDF预览按钮、8个原站下载链接、PDF点击产生新窗口、0relay请求/0dialog。合成PDF域名网络失败，不作为官方PDF显示证据。app typecheck仍有历史全库诊断，修改组件无诊断；TSX lint因既有React插件规则缺失未通过。

基线main 0c9e6a7；本轮为普通可逆UI行为收窄，自审完成。未提交、推送或部署，未写生产数据，不沿用历史hook豁免。原Issue88已部署版本与本地新改动必须区分。证据见.local/attachment-88/pdf-only-*.txt。
