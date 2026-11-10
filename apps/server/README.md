# 七叔平台数据服务

Node.js 24 内置 HTTP、SQLite，无第三方 Node 运行依赖。运行 `npm start` 后默认 `http://127.0.0.1:4188`，同时提供网页静态资源与 `/api`。前端、微信源码和此服务通过接口协作。

## 环境与数据

将本目录 `.env.example` 复制为工程根目录 `.env` 再填写服务端变量。`npm start` 会读取根目录 `.env`；不要提交真实凭证。直接执行 Node 时自行提供环境。PowerShell 的微信配置名称为 `WX_APP_ID`、`WX_APP_SECRET`，数据库路径由 `DATA_DIR`、可选 `DB_PATH` 决定。域名、HTTPS、微信后台合法域名、AppID配置必须与实际部署一致。

开发模式有合成示例商家、内容和固定测试身份。`POST /api/auth/demo {role,userId?,scope}` 返回 HttpOnly Cookie 与随机 Bearer Token，固定用户包括 `owner-01`、`owner-02`、`owner-guest`（未认证）、`supplier-01`、`supplier-02`、`supplier-guest`、`admin-01`。厂家示例账号也需补齐新材料，不预设资质通过。此入口仅开发模式开放，并且不能冒用真实微信账号。

所有API用 `X-Qishu-Scope: front|back` 标记当前端口；省略为front。登录body.scope必须一致。前台三身份，后台仅厂家和获授平台管理员。Cookie分别为 `qishu_front_session`、`qishu_back_session`，Bearer在SQLite内绑定scope，另一端登录/退出不替换或清除本端会话。`/api/admin/*`和导入管理只接受back；前台管理员也拿不到后台提示词、官方知识原文或跨用户任务。原旧无scope Cookie失效，旧Bearer仅可能按front处理，绝不作为back。角色按会话意向及实际授权投影，不因切端而改写数据库持久role。

生产使用 `NODE_ENV=production`、`ALLOW_DEMO_AUTH=false`、独立全新 `DATA_DIR`。生产初始化仅加入默认字典、可编辑方案和禁用的模型渠道，不生成虚构的公开内容、商家或已认证账号。直接用演示库进入正式模式会明确拒绝启动；原库不会被清理。真实资料需重新审核导入。初始付费方案尚未启用，平台应先配置实际权益。

`BOOTSTRAP_ADMIN_PHONE` 只在首次空库创建管理员手机号白名单；该手机号本人仍需真实微信授权、手机号授权后才能绑定并获得权限。后续管理员在后台授权。撤销白名单对已有会话生效。不要把开放的开发演示账号部署为正式后台登录。

数据库、上传资料、模型参数与 `secrets.key` 均在 `data`（或指定目录）内。API密钥使用 AES-256-GCM 加密，读取脱敏；备份必须同时保护数据库与加密主密钥，不能只备份SQLite。此实现是单实例方案，生产扩容前需迁移数据库、共享对象存储、会话与任务队列。

## 微信认证流程

1. 小程序 `wx.login` 获得一次性 code，调用 `/api/auth/wechat {code,requestedRole:owner|supplier|admin,scope}`，兼容role字段。服务端请求官方 `sns/jscode2session`，创建独立会话。admin只是登录/申请意向；无平台授权返回 `adminAuthorizationRequired`，不能自行提权。`session_key` 不回传、不持久化。
2. 本人通过微信手机号授权按钮获得 phone code，带 Bearer 调用 `/api/auth/phone {code}`。服务端缓存官方 `stable_token`，调用 `wxa/business/getuserphonenumber`，校验手机号和可用的 AppID watermark，不能接受前端直接填写的手机号作为核验结果。
3. 经营资料上传后保持私有，提交 `/api/certifications` 进入待人工审核。若已有启用、带密钥且声明ocr能力的渠道，自动排入OCR识别任务；本人和授权管理员读取审核记录时同步任务状态、提取字段及填报一致性提示。无渠道明确not-configured，识别失败仍保留人工待审，任何AI结果都不会自动通过认证。服装批发、零售视为行业准入，无需另证女装；文字识别不等于执照验真。人工通过才开放对应经营权限。
4. 微信服务未配置返回503；凭证失效、使用过或官方拒绝不会生成登录成功结果。真实凭证与微信真机授权仍需部署后联调。官方HTTP协议已通过注入式 mock 测试，mock 通过不等于真实微信审核通过。

厂家认证另须 `venueVideoFileId` 及恰好5个不同的 `venuePhotoFileIds`。视频通过 `/api/uploads?purpose=certification_video` 流式multipart上传，单文件最多300MiB；普通上传仍25MiB，照片purpose为certification_photo，执照license。服务端用ffprobe解码计帧核验真实时长至少30秒，不接受客户端duration；ffmpeg实际解码照片，并比较文件哈希与归一化像素哈希，重复、伪图、他人材料均拒绝。需安装可执行ffprobe和ffmpeg，可由 `QISHU_FFPROBE` / `QISHU_FFMPEG` 指定；工具不可用明确阻止认定合格，不能靠文件名或浏览器时长代替。

厂家材料合格仍是pending。获授审核员通过专用 `POST /api/admin/certifications/:id/phone-review` 记录真实人工电话、结果、备注和时间，服务端记录操作人。只有result=confirmed（已接通且核对一致）、confirmedCall=true才记passed；unreachable保持待回访，inconsistent/rejected失败，任何回访结果都不自动批准。平台再人工PATCH approved才解锁。更改材料/主体、改为待审、删除当前认证会撤回权限；历史厂家缺新材料自动needs_more但不删除原记录，旧申请不能覆盖新申请。店主继续执照人工审核，不强加厂家视频与回访条件。

原始证照/照片/视频只供本人或back端获授certifications权限的审核员读取。返回的短期材料URL同时绑定scope、当前Cookie/Bearer和有效会话；复制链接给游客或其他用户不能读取。Web播放器使用URL的scope选择同端Cookie；小程序应带Bearer下载到本机临时文件后预览，不能把链接当公开媒体。所有认证用途文件禁止转成资讯/商品公开素材。

接口依据：[登录](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)、[手机号](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html)、[稳定令牌](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html)。

## 业务与隔离

- 每日主动联系按厂家主体及中国标准时间计量，同一主体同一店主当天不重复扣额，数据库事务负责扣额与写入。只记录联系意向、回访，不声称微信已添加或货品已成交。套餐 `contactMethods` 支持 `wechat`、`phone`、`qrcode`；渠道权限在后端过滤。
- 本人通过 `GET/PATCH /api/profile/contact` 管理联络资料；写入需资质审核通过，真实微信账号还需手机号核验。联系方式仅做格式校验与展示授权，不保证微信号归属或已添加。明确consent后才按线索额度及渠道权限返回，不进入bootstrap或用户、店主列表。本人私有二维码按授权签发短期链接，撤回后旧链接失效；关联店主卡片仅同步既有真实记录，不创建虚构需求。
- 首发权益由后台记录线下购买确认后开通，无货品订单、支付或结算。
- CMS配置验证后写入版本，可回退；模块关闭只影响该模块。推荐不可用时返回已审核内容。服务故障会保留明确错误，无法保证服务器整体停机或数据库损坏时继续提供所有服务；部署层仍需备份和静态站点保障。
- 上传默认私有。公开创作素材须声明 `purpose=content`，且管理员审核发布后才获得公开读取权限；隐藏/删除后按剩余公开引用回收。执照、私有知识、诊断原件不会因内容引用而转公开，需另上传获授权的内容副本。
- 平台知识原文不向普通用户列出，个人和企业知识按主体授权。用户反馈不会自动写入共享知识或训练。
- 双塔推荐包含独立用户、物品投影矩阵、实际梯度训练、点积召回与持久化参数；初始样本为合成演示偏好，效果不代表真实业务增长。行为使用本站搜索、点击、有效停留等，不读取用户微信站外行为。
- AI任务支持按能力配置的真实渠道；不填密钥时明确失败。模型ID、费用、真实账号、厂商支持能力需逐一联调，不能将名称填入注册表当作已接通。OCR不能凭图片保证资质真实，最终仍由人工决定。
- 大文件导入模块来自 `packages/ingestion`，分片与结构拆解独立排队；AI归类是后续能力，人工确认前不公开。导入商品缺少厂家、产地、风格、品类、价格或起批量时拒绝公开，不猜测补齐。

## 验证

工程根目录执行 `node --test tests/backend*.test.mjs`。覆盖会话、正式模式禁演示、租户隔离、资质私有读取、CMS版本回退、权益原子扣额、媒体公开及撤回、真实向量训练、模型缺配置失败、导入发布与数据库重启。微信HTTP通过测试传输层模拟官方响应，未使用真实微信凭证。全工程测试还覆盖独立导入解析、微信源码与模型适配器。
