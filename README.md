# BiliArm

BiliArm 是一个 Manifest V3 浏览器扩展，用于整合 B 站网页端的推荐净化、黑名单管理、播放器快捷键、截图、反追踪、CDN 优化和页面样式优化。

项目地址：[BiliArm](https://github.com/newAres/BiliArm)

## 当前实现范围

- 首页推荐流净化。
- 本地黑名单，数据保存在扩展 IndexedDB：`BiliArmDB`。
- 首页和播放页的本地拉黑按钮。
- 可选账号拉黑，默认关闭，开启后会二次确认。
- 播放页推荐内容按黑名单隐藏。
- 播放器快捷键。
- B 站默认快捷键展示。
- 扩展快捷键修改、禁用、恢复默认。
- 默认关闭弹幕、默认显示模式、自动播放、播放结束退出全屏。
- 弹幕、字幕、时间、标题、进度、画面缩放相关功能。
- 截图到文件、截图到剪贴板、画中画、逐帧、倍速。
- 可选反追踪和 CDN 优化，默认关闭。
- 评论 IP 属地、话题标签、隐藏置顶广告评论等开关。
- 参考用户提供样图实现的左右分栏设置页。

## 加载方式

1. 打开 Chrome 或 Edge 的扩展管理页面。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择项目根目录。

## 许可与来源说明

本项目使用 MIT License。

本项目功能设计与部分实现思路参考并静态分析了以下扩展：

- [Better Bilibili](https://chromewebstore.google.com/detail/better-bilibili/oofhgjpnnopfghkigjebdacghcoeanlh) 2026.02.13，开发者 cyclelws。
- [Bilibili Player Extension](https://chromewebstore.google.com/detail/extension-for-bilibili-pl/ffoljpljalicgkljioegejmigkkkincm) 3.0.2，开发者 Guokai Han / guokai.dev。

截至 2026-05-04，未发现上述两个参考扩展的公开 GitHub 仓库地址；因此上方链接使用其公开 Chrome Web Store 页面作为可核验来源。本项目 GitHub 地址为：[BiliArm](https://github.com/newAres/BiliArm)。

当前源码不是直接复制压缩脚本，而是将已选择保留的行为重写为模块化、带注释、可维护的 BiliArm 实现。每个源码文件头部均包含 MIT / SPDX 标注。原扩展名称、作者、商店页和功能描述仅用于来源说明与致谢，不表示原作者对本项目背书。

## 风险提示

以下功能默认关闭或可独立关闭：

- 账号拉黑。
- 反追踪。
- CDN 优化。
- 网络请求拦截。

如果 B 站页面出现播放、评论或推荐异常，请优先关闭这些模块。
