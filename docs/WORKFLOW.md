# 完整归档流程：下载 → 合并校验 → 结构化 → 导入 Notion

扩展和控制台脚本只负责**下载**。这一篇是下载之后的全套口径，
来自一次真实的万级动态全量归档实践。

## 接口速查（最后实测：2026-10）

- `POST https://api.ruguoapp.com/1.0/personalUpdate/single`
- 请求头：`x-jike-access-token: <localStorage 的 JK_ACCESS_TOKEN>`、
  `content-type: application/json`
- 请求体：`{username, limit: 20, loadMoreKey?}`（首页不传 key，
  后续传上一页响应顶层 `loadMoreKey`）
- 响应：`{success, data: [帖子...], loadMoreKey}`，从新到旧排列
- 旧 GraphQL 地址 `web-api.okjike.com/api/graphql` 已作废（404）。
  接口若再变，先在页面开发者工具的网络面板找 `personalUpdate` 请求。
- 令牌寿命约 20–25 分钟 / 约 870 页，401 是常态不是封禁；
  页面自身 socket.io 的 401 是同一原因，忽略。

## 多段合并与校验

长历史必然分多段下载（令牌过期、floor 分段）。合并时逐项断言，
任何一条不过就停下来查，不要硬合并：

1. 全集 Post ID 唯一、整体严格递减（接口按时间倒序，ID 本身也单调）。
2. 段间接缝：后一段的最新一条严格小于前一段的最旧一条；
   若两段有重叠，重叠部分应逐条一致。
3. 每条断言：Post ID 前 8 位十六进制是内嵌的 Unix 时间戳，
   其北京时间日期必须等于 `createdAt` 的北京时间日期。
4. 完整性锚点：最旧一条应接近账号注册日；账号内部不应出现
   与本人发帖密度不符的大日期断层（例如活跃账号出现 >14 天空白）。
5. 可选交叉验证：手动在主页列表采一小段（分享图文件名里带 Post ID），
   与接口数据逐条比对正文与计数，应零差异。

## 转结构化主数据（jsonl）的字段口径

每条帖子转一行 JSON，字段约定：

- `text` = `content` 去换行拼接；content 为空时用 `linkInfo.title`
  （链接/音乐/视频帖）；仍为空即纯图片帖。
- `topic` 取 `topic.content`；转发帖（`type == "REPOST"`）topic 留空、
  类型记「转发」，text 只记转发语（即 content）。
- `media` 推导：`pictures` 1 张记「图片」、N 张记「图片×N」；
  否则有 `video` 字段记「视频」；否则 `linkInfo` 有 audio 记
  「音乐链接」、有 video 记「视频链接」、其他记「链接」。
- 计数取 `likeCount` / `commentCount` / `repostCount`。
- `date` 由 `createdAt` 转北京时间（并过上面第 3 条断言）。

## 导入 Notion 的口径（可选）

建一个数据库，属性建议：标题（title）、Post ID（text，去重键）、
发布时间（date）、Permalink（url）、类型（select：原创/转发）、
点赞/评论/分享（number）、话题（text）、媒体（text）。

- 每批 ≤12 页写入；**批次数据必须是 pages 裸数组**
  `[{properties...}, ...]`——多包一层 `{parent, pages}` 会被整批
  校验挡下（一整个大段因此零落库的教训）。parent 在调用时单独传。
- 发布时间可以不依赖 createdAt，直接由 Post ID 前 8 位时间戳还原、
  截断到分钟，格式与手工存量保持一致。
- 标题 = 正文；无正文的纯图片帖标题用「（图片动态）」+ 话题。
- 每批写完核对返回的 Post ID 与批次完全一致后，才把这批 ID 追加到
  本地的 `imported-post-ids.json` 并落 `.done.json` 标记；失败即停，
  重跑自动跳过已完成批，天然断点续写、不会重复建页。
- 最后做总比对再宣布完成：本地全量 ID 集合 vs Notion 库内 distinct
  ID 集合、总页数、已知重复页、首尾边界帖，全部对齐才算归档结束。
  注意 Notion 工作区的查询额度可能被全量拉取打爆，总比对尽量用
  本地文件和已下载的接口全量数据替代反复查库。

## 踩过的坑

- **往 localStorage 里存已抓帖子必爆配额**（约 5–10MB，一千条上下
  就满）：早期版本每页把全部节点存 localStorage 做断点，结果存档
  全失败、断点停在旧游标。定版做法：只存游标，或用扩展的
  `chrome.storage.local` + `unlimitedStorage` 存全量进度。
- 控制台刷屏 `QuotaExceededError` 时先看计数是否还在涨：抓取没停
  就别关页面别刷新，等它把文件下载完。
- 节奏 2.5 秒/页、不并发：防限流/封号优先于速度。
