# Read Frog Lite for Via

面向 Via 浏览器的轻量级网页翻译用户脚本，当前版本为 **v1.0.0**。

> 本项目基于 [Read Frog](https://github.com/mengxi-ream/read-frog) 进行二次开发。  
> This project is a modified work based on Read Frog.

由于 Via 浏览器长期缺少为移动端阅读场景专门设计的翻译脚本，本项目参考 Read Frog 的设计与翻译思路，使用 Vibe Coding 完成了适配 Via 的轻量实现。它专注于手机上的网页阅读与手动翻译体验，不是 Read Frog 官方版本。

## 简介

Read Frog Lite for Via 以单文件用户脚本形式运行在 Via 中。点击悬浮青蛙即可渐进翻译正文；支持直接替换原文或双语对照，也可对选中文本单独翻译、朗读与复制。

## Features

- 为 Via 浏览器和 Android WebView 的移动阅读场景优化
- 渐进式网页正文翻译，优先处理当前阅读区域
- 双语对照与“直接替换原文”模式，可随时切换或恢复原文
- 划词翻译、译文复制与系统朗读
- Microsoft 免费翻译、OpenAI、DeepSeek 与 OpenAI Compatible API
- 翻译缓存、批量控制、并发控制、失败段落单独重试
- 正文智能识别，尽量避开导航、工具栏、表单、代码与隐藏内容
- 可拖动、贴边半隐藏的青蛙悬浮球，以及 Material 风格设置面板

## Installation

1. 下载或复制 [`src/read-frog-lite-via.user.js`](src/read-frog-lite-via.user.js)。
2. 将文件传到 Android 设备，或复制完整脚本内容。
3. 在 Via 中打开“设置 → 脚本”，从本地导入脚本或新建脚本后粘贴保存。
4. 启用脚本并刷新网页。页面右侧会出现半隐藏的青蛙悬浮球。
5. 轻点一次悬浮球将其呼出；再次轻点开始翻译。长按可打开翻译模式、恢复原文与设置等操作。

> Via 的菜单名称可能因版本或语言略有不同；核心步骤是导入并启用用户脚本，然后刷新目标网页。

## Configuration

长按悬浮球，选择“设置”即可配置服务、语言、显示模式、每批段落数与并发数。

| 服务 | 是否需要 API Key | 说明 |
| --- | --- | --- |
| Microsoft | 否 | 默认免费服务，适合首次使用与日常阅读。 |
| OpenAI | 是 | 使用官方 Chat Completions 接口。 |
| DeepSeek | 是 | 脚本固定使用 `https://api.deepseek.com/chat/completions`。 |
| Custom API | 通常需要 | 兼容 OpenAI Chat Completions 的自定义服务；填写基础地址即可，脚本会补全 `/chat/completions`。 |

对于 OpenAI、DeepSeek 与自定义接口，请填写自己的 API Key 和模型名称。请先使用“测试服务”确认配置可用，再翻译网页。

## Compatibility

- 设计目标为较新的 Via 浏览器与 Android System WebView。
- 脚本优先使用 Via 提供的 `GM_*` API；在缺少部分 API 的环境中会尝试标准 Web API 作为降级路径，但自定义跨域接口可能无法工作。
- 自定义接口默认要求 HTTPS；仅 `localhost`、`127.0.0.1` 与 Android 模拟器地址 `10.0.2.2` 可使用 HTTP。
- Canvas、PDF 查看器、封闭 Shadow DOM 等不提供普通网页 DOM 正文的页面，可能无法识别可翻译内容。

## Privacy

- API Key 保存在 Via 的本地用户脚本存储中，不会由本脚本上传到开发者服务器；它不是加密保险库，请不要在不受信任或多人共用的设备上保存敏感 Key。
- 只有在你手动发起网页翻译、划词翻译或测试服务时，待翻译文本才会发送给你选择的翻译服务。
- 使用 Microsoft 服务时，文本会发送到 Microsoft 翻译服务；使用 AI 或自定义服务时，文本会发送到对应 API 提供方。请同时阅读该服务提供方的隐私政策。
- 本脚本不包含统计、遥测、广告或开发者数据收集代码。
- 脚本声明 `GM_xmlhttpRequest` 和 `@connect *`，是为了在 Via 中绕过网页跨域限制，并支持用户自行配置的 OpenAI Compatible API。请只填写可信服务地址，并妥善保管 API Key。

## Credits

感谢 [Read Frog](https://github.com/mengxi-ream/read-frog) 原作者与贡献者提供的开源项目、设计思路和参考实现。

## License

本项目采用 [GPL-3.0-only](LICENSE) 许可证发布。

发布或再分发修改版本时，请保留上游归属与许可证声明，并同时提供对应源码。
