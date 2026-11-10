# 平台适配层

业务 API、身份、审核、素材、推荐和任务模型共用服务端契约。各端的登录、上传、导航、字体与录音通过适配层调用，不把浏览器对象搬进微信页面。

| 平台 | 当前交付 | 验证边界 |
|---|---|---|
| 微信小程序 | 原生 JS/WXML/WXSS；实现 request/upload/storage/login/media/recorder/navigation/font | 已有源码及静态检查；需微信开发者工具编译和真机验收 |
| Web / 桌面浏览器 | 独立网页应用，由 `apps/web` 提供 | 不代表微信授权能力 |
| 抖音小程序 | 接口契约与能力登记预留 | 尚无抖音实现、构建与真机结果 |
| Android / iOS / 鸿蒙原生 App | 接口契约预留 | 尚无原生 App 工程、打包或厂商上架 |

微信当前实现的唯一源码在 `apps/miniprogram/platform/wechat.js`。微信发布包不能跨工程根目录 require，因此该文件随原生工程保存；本目录不复制第二份实现。

后续平台须实现 `contract.d.ts` 并申明 `capabilities.json` 的实际状态；缺少的能力返回明确错误，不能用浏览器 H5 预览冒充小程序或原生 App。

服务器接口以 `../contracts/API.md` 为准。API Key、微信 AppSecret、模型系统提示词与官方底层知识库均只保存在服务端。
