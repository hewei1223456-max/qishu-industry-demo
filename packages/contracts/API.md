# 七叔平台共享接口约定

前端使用 /api，JSON错误为 {error:{code,message}}，成功为对象或数组。Session cookie HttpOnly。开发演示登录只在服务端启用演示模式时开放，不代表真实微信认证。

- POST /api/auth/demo {role:owner|supplier|admin} -> {user,token}; GET /api/auth/me -> {user}; POST /api/auth/logout。开发接口生产默认禁用，小程序使用Bearer token。
- POST /api/auth/wechat {code,role?:owner|supplier} -> {user,token}；POST /api/auth/phone {code} -> {user}。正式接口由服务端向微信换取标识和手机号，AppSecret/session_key不得到客户端；缺配置返回明确503。
- GET /api/bootstrap -> {user,config,dictionaries,providers,modules}
- GET /api/content?query=&category= -> {items}; GET /api/content/:id
- GET /api/products?style=&origin=&category=&priceMin=&priceMax=&moqMax=&status=&query= -> {items}; GET /api/products/:id
- GET /api/fairs -> {items}; GET /api/fairs/:id；POST /api/fairs/:id/register -> 意向登记，不收取货款或报名款
- GET /api/buyers?query=&city=&style= -> {items}; POST /api/leads {buyerId|supplierId,productId?} -> {lead,quota}; GET /api/leads -> {items}; PATCH /api/leads/:id {status,note}
- GET /api/quota -> {used,limit,remaining,plan}; GET /api/creator -> {items}; POST /api/creator {kind,title,body,...}; PATCH /api/creator/:id
- POST /api/events {type,itemId,itemType,duration?}; GET /api/recommendations?kind=content|products -> {items,strategy,modelVersion}; POST /api/profile/tags {tags}; PATCH /api/profile/preferences {personalized}
- GET /api/knowledge -> {items}; POST /api/knowledge {title,body,scope}; DELETE /api/knowledge/:id
- GET /api/jobs -> {items}; POST /api/jobs {task:chat|diagnosis|ocr|asr|tts|image|video,message?,profile?,fileId?,model?} -> {job}; GET /api/jobs/:id
- POST /api/uploads multipart file -> {file:{id,name,url,mime,size}} (public images available under /uploads; private docs access-controlled)
- POST /api/certifications {company,scope,licenseFileId} -> {application}; GET /api/certifications
- GET /api/admin/:resource -> {items}; POST /api/admin/:resource; PATCH /api/admin/:resource/:id; DELETE /api/admin/:resource/:id
- resource: content,products,fairs,buyers,certifications,plans,entitlements,providers,knowledge,admins
- GET /api/admin/config -> {config}; PUT /api/admin/config {config}; POST /api/admin/config/rollback
- POST /api/admin/models/train -> {model}; GET /api/admin/metrics -> object; GET /api/admin/audit -> {items}

配置采用版本校验后原子发布，feature flags关闭只影响对应模块；供应商密钥只接受写入且读取时脱敏，不能进入bootstrap。各端按实际支持能力适配，不将浏览器API直接用于小程序。

大文件资料接口见 [ingestion](../ingestion/README.md)：8MiB分片、最多1GiB/文件、原件私有、拆卡预览/人工编辑/确认发布分开。普通文件上传最多25MiB。AI理解是独立步骤，未配置不能冒充已完成。

GET/PATCH `/api/profile` 读取/保存本人经营资料，白名单为name、shop、city、style、customerAge、retailPriceBand、area、businessYears、operationNeeds；不能修改role、verified、手机号或已审主体。

GET/PATCH `/api/profile/contact` 仅本人维护`wechat,phone,qrUrl,consent`。修改需要资质权限，真实微信账号还需手机号验证。明确同意后仍只经受控联系链路向有权对方返回，不出现在公开用户和货源列表；撤回会使旧线索及二维码预览失效。

POST `/api/ingestion/jobs/:id/understand` 返回202和后台任务；轮询GET任务，`status=understanding`期间不可覆盖编辑或发布。成功、部分完成、失败分别标记provider_completed、partial、failed，原文不因分类被替换。重启中断可重试，超大文本按批次归类。
