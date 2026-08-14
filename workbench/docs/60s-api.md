# 60s API 项目接入文档

> 本文面向 Claude Code 和项目开发者。它描述当前自建实例的固定接入方式、已验证能力和调用约束；完整字段说明仍以上游官方文档和实际响应为准。

## 1. 服务信息

| 项目 | 当前值 |
| --- | --- |
| 服务名称 | 60s API 自建实例 |
| Cloudflare Worker | `60s` |
| Base URL | `https://your-60s-instance.example.com` |
| 健康检查 | `GET /health` |
| 服务信息 | `GET /` |
| 实时路由清单 | `GET /endpoints` |
| 当前部署版本 | `6f652d15-c82d-402b-82ed-b135145746ff` |
| 部署日期 | 2026-08-10 |
| 鉴权状态 | 无鉴权，公网可访问 |
| 上游源码 | <https://github.com/vikiboss/60s> |
| 官方 API 文档 | <https://docs.60s-api.viki.moe> |

生产代码必须通过配置读取 Base URL，不要在多个业务文件中散落硬编码地址。

推荐环境变量：

```dotenv
SIXTY_SECONDS_API_BASE_URL=https://your-60s-instance.example.com
```

## 2. Claude Code 必须遵守的规则

1. 涉及新闻、热搜、天气、壁纸等 60s API 功能时，先阅读本文。
2. 默认使用自建实例 `https://your-60s-instance.example.com`。
3. 未经用户明确允许，不要自动改用 `https://60s.viki.moe` 或其他公共实例。
4. 不要猜测路由名、参数名或响应字段；优先查本文，其次查官方文档，最后用 `/endpoints` 和真实请求确认。
5. 所有用户输入都必须通过 `URLSearchParams` 或等价方式编码，禁止直接拼接查询字符串。
6. JSON 调用必须同时检查 HTTP 状态和响应体中的 `code`。
7. 外部数据源可能暂时不可用。调用方必须设置超时，并向上层返回明确的“上游服务不可用”状态。
8. 只有幂等的读取请求可以自动重试；参数错误、解析错误和业务错误不得盲目重试。
9. 不要把外部返回内容当作可信 HTML 直接插入页面；展示前应转义或按安全的结构化字段渲染。
10. 新增正式依赖的接口必须先真实调用验证，再把验证日期和结果补充到本文。

可在项目 `CLAUDE.md` 中加入：

```markdown
## 60s API

涉及新闻、热搜、天气、壁纸等功能时，先阅读 `docs/60s-api.md`。

必须优先使用环境变量 `SIXTY_SECONDS_API_BASE_URL` 指向的自建实例。
除非用户明确授权，否则不得切换到官方或社区公共实例。
不得猜测接口参数；接入新接口前必须查阅文档并进行真实请求验证。
```

## 3. 通用请求与响应约定

### 3.1 返回格式

除特殊接口外，可使用 `encoding` 查询参数选择格式：

| `encoding` | 返回格式 | 使用场景 |
| --- | --- | --- |
| 省略或 `json` | JSON | 程序调用，默认选择 |
| `text` | 纯文本 | 消息推送、命令行展示 |
| `markdown` | Markdown | AI 上下文或 Markdown 渲染 |

图片、RSS 等接口可能返回图片、XML、重定向或其他内容类型。调用方应以实际 `Content-Type` 为准，不能一律按 JSON 解析。

### 3.2 JSON 响应外层结构

常见成功响应：

```json
{
  "code": 200,
  "message": "获取成功。",
  "data": {}
}
```

调用成功的判定条件：

- HTTP 状态为 `2xx`；
- 响应能够按预期内容类型解析；
- JSON 响应的 `code` 为 `200`。

不要只判断 HTTP 200。部分接口可能通过 JSON 中的 `code` 或 `message` 表达上游业务失败。

### 3.3 字段命名

- 可读时间通常使用 `updated`、`created` 等字段。
- 对应的 13 位毫秒时间戳通常以 `_at` 结尾，例如 `updated_at`。
- 原文或详情链接通常命名为 `link`。
- 封面或主图通常命名为 `cover`。
- 字段应按可选值处理；上游数据源变化时，个别字段可能缺失或为 `null`。

## 4. 推荐客户端封装

### 4.1 TypeScript

```ts
const API_BASE_URL = (
  process.env.SIXTY_SECONDS_API_BASE_URL ||
  'https://your-60s-instance.example.com'
).replace(/\/$/, '')

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
}

export async function call60sApi<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(path, `${API_BASE_URL}/`)

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`60s API HTTP ${response.status}`)
  }

  const body = (await response.json()) as ApiEnvelope<T>

  if (body.code !== 200) {
    throw new Error(`60s API ${body.code}: ${body.message}`)
  }

  return body.data
}

// 示例
const dailyNews = await call60sApi('/v2/60s')
const beijingWeather = await call60sApi('/v2/weather/realtime', {
  query: '北京',
})
```

如果项目运行环境不支持 `AbortSignal.timeout`，使用 `AbortController` 和定时器实现同样的超时行为。

### 4.2 cURL

```bash
# 健康检查
curl --fail --show-error \
  "https://your-60s-instance.example.com/health"

# 每日新闻 JSON
curl --fail --show-error \
  "https://your-60s-instance.example.com/v2/60s"

# 每日新闻纯文本
curl --fail --show-error \
  "https://your-60s-instance.example.com/v2/60s?encoding=text"

# 北京实时天气
curl --fail --show-error --get \
  --data-urlencode "query=北京" \
  "https://your-60s-instance.example.com/v2/weather/realtime"
```

## 5. 核心接口

### 5.1 每天 60 秒读懂世界

```http
GET /v2/60s
```

常用调用：

```text
/v2/60s                         JSON，程序处理
/v2/60s?encoding=text           纯文本
/v2/60s?encoding=markdown       Markdown
/v2/60s?encoding=image          重定向到原图
/v2/60s?encoding=image-proxy    由 Worker 代理图片二进制
/v2/60s/rss                     RSS XML
```

当前 JSON `data` 已验证包含：

```text
date, news, cover, tip, image, link,
created, created_at, updated, updated_at,
day_of_week, lunar_date, api_updated, api_updated_at
```

2026-08-10 实测 `news` 为 15 条。调用方不应把 15 写成永久固定限制，应允许上游调整数量。

### 5.2 热门榜单

| 功能 | 路径 |
| --- | --- |
| 微博热搜 | `/v2/weibo` |
| 知乎话题榜 | `/v2/zhihu` |
| 抖音热搜 | `/v2/douyin` |
| 哔哩哔哩热搜 | `/v2/bili` |
| 今日头条热搜 | `/v2/toutiao` |
| 百度实时热搜 | `/v2/baidu/hot` |
| 百度电视剧榜 | `/v2/baidu/teleplay` |
| 百度贴吧话题榜 | `/v2/baidu/tieba` |
| 小红书热点 | `/v2/rednote` |
| 懂车帝热搜 | `/v2/dongchedi` |
| 夸克热点 | `/v2/quark` |
| IT 之家资讯 | `/v2/it-news` |
| IT 之家榜单 | `/v2/it-news/rank` |
| Hacker News Top | `/v2/hacker-news/top` |
| Hacker News New | `/v2/hacker-news/new` |
| Hacker News Best | `/v2/hacker-news/best` |

微博接口当前返回数组项结构：

```json
{
  "title": "热搜标题",
  "hot_value": 123456,
  "link": "https://s.weibo.com/..."
}
```

2026-08-10 实测微博返回 50 项。调用方应允许数量变化，并将 `hot_value` 视为可能缺失的展示字段。

### 5.3 天气

实时天气：

```http
GET /v2/weather/realtime?query=北京
```

天气预报：

```http
GET /v2/weather/forecast?query=雨花台&days=7
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `query` | 否 | 地点关键词，默认北京；必须进行 URL 编码 |
| `days` | 否 | 预报天数，仅用于 forecast，默认 7 |
| `city` | 否 | 城市辅助定位 |
| `province` | 否 | 省份辅助定位 |

实时天气 `data` 已验证包含：

```text
location, weather, air_quality, sunrise,
life_indices, alerts
```

兼容旧路由 `/v2/weather` 当前仍存在，但新代码应使用 `/v2/weather/realtime`。

### 5.4 必应每日壁纸

```http
GET /v2/bing
```

常见字段包括：

```text
title, headline, description, main_text,
cover, cover_4k, copyright,
update_date, update_date_at
```

### 5.5 生成二维码

```http
GET /v2/qrcode?text=Hello
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `text` | 是 | 二维码内容 |
| `size` | 否 | 图片尺寸，默认 256 |
| `level` | 否 | 纠错级别：`L`、`M`、`Q`、`H`，默认 `M` |
| `type` | 否 | QR type number；一般无需指定 |
| `encoding` | 否 | `json`、`text`、`markdown` 或 `image` |

直接获取图片：

```bash
curl --fail --show-error --get \
  --data-urlencode "text=Hello Claude" \
  --data-urlencode "encoding=image" \
  "https://your-60s-instance.example.com/v2/qrcode" \
  --output qrcode.gif
```

### 5.6 在线翻译

```http
GET /v2/fanyi?text=こんにちは&from=auto&to=auto
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `text` | 是 | 待翻译文本 |
| `from` | 否 | 源语言代码，默认 `auto` |
| `to` | 否 | 目标语言代码，默认 `auto` |

支持的语言代码必须从以下接口读取，不要自行猜测：

```http
GET /v2/fanyi/langs
```

### 5.7 身体健康分析

```http
GET /v2/health?height=175&weight=70&gender=male&age=30
```

| 参数 | 必填 | 允许值 |
| --- | --- | --- |
| `height` | 是 | 50–300，单位 cm |
| `weight` | 是 | 10–300，单位 kg |
| `gender` | 是 | `male` 或 `female` |
| `age` | 是 | 1–150 |

返回结果仅供一般信息展示，不能作为医疗诊断或医疗建议。

## 6. 当前全部路由

以下列表来自 2026-08-10 对自建实例 `/endpoints` 的真实读取，共 75 条。路由存在不代表依赖的第三方数据源永久可用。

### 6.1 周期资讯与内容

```text
/v2/60s
/v2/60s/rss
/v2/ai-news
/v2/bing
/v2/exchange-rate
/v2/today-in-history
/v2/epic
/v2/it-news
/v2/it-news/rank
/v2/moyu
```

### 6.2 热门榜单

```text
/v2/bili
/v2/douyin
/v2/toutiao
/v2/weibo
/v2/zhihu
/v2/rednote
/v2/dongchedi
/v2/quark
/v2/baidu/hot
/v2/baidu/teleplay
/v2/baidu/tieba
/v2/hacker-news/new
/v2/hacker-news/top
/v2/hacker-news/best
/v2/ncm-rank/list
/v2/ncm-rank/:id
/v2/maoyan/all/movie
/v2/maoyan/realtime/movie
/v2/maoyan/realtime/tv
/v2/maoyan/realtime/web
/v2/douban/weekly/movie
/v2/douban/weekly/tv_chinese
/v2/douban/weekly/tv_global
/v2/douban/weekly/show_chinese
/v2/douban/weekly/show_global
```

### 6.3 实用工具

```text
/v2/baike
/v2/ip
/v2/lunar
/v2/qrcode
/v2/whois
/v2/health
/v2/password
/v2/password/check
/v2/weather/realtime
/v2/weather/forecast
/v2/color/random
/v2/color/palette
/v2/lyric
/v2/fuel-price
/v2/gold-price
/v2/olympics
/v2/olympics/events
/v2/og
/v2/hash
/v2/fanyi
/v2/fanyi/langs
```

### 6.4 娱乐与随机内容

```text
/v2/answer
/v2/changya
/v2/chemical
/v2/duanzi
/v2/fabing
/v2/hitokoto
/v2/kfc
/v2/luck
/v2/awesome-js
/v2/dad-joke
```

### 6.5 Beta 接口

```text
/v2/beta/kuan
/v2/beta/qq/profile
```

Beta 接口不应直接用于关键生产流程，除非项目自行增加降级方案和契约测试。

### 6.6 兼容旧路由

```text
/v2/exchange_rate
/v2/today_in_history
/v2/maoyan
/v2/baidu/realtime
/v2/weather
/v2/ncm-rank
/v2/color
```

新代码应使用对应的新路由，不要继续扩大旧路由使用范围。

## 7. 超时、重试与缓存

以下是本项目的推荐接入策略，不是上游服务承诺：

### 7.1 超时

- 普通 GET：10 秒。
- 图片或较大响应：20 秒。
- 超时后返回可识别的上游超时错误，不要一直等待。

### 7.2 重试

只对读取型 GET 请求的以下情况最多重试 2 次：

- 网络连接失败；
- HTTP `429`；
- HTTP `502`、`503`、`504`。

推荐退避时间为约 500 ms、1500 ms，并加入少量随机抖动。若响应带 `Retry-After`，优先遵守该值。

不要重试：

- HTTP `400`、`401`、`403`、`404`；
- 参数缺失或参数格式错误；
- JSON 结构与预期不一致；
- 已明确返回的业务错误。

### 7.3 缓存建议

| 数据类型 | 建议缓存时间 |
| --- | --- |
| 每日新闻、每日壁纸 | 10–30 分钟 |
| 热搜榜单 | 1–5 分钟 |
| 实时天气 | 5–10 分钟 |
| 天气预报 | 30–60 分钟 |
| 历史、语言列表等低频数据 | 1–24 小时 |

前端页面不应在短时间内为每个用户重复请求同一份公共数据。优先在服务端聚合或缓存。

## 8. 安全与使用边界

- 当前 Worker 没有 API Key、Token 或访问控制，任何人都能调用。
- 不要把此服务当作存储隐私数据或处理机密文本的受控后端。
- 翻译、二维码、OG、WHOIS 等参数可能被发送到上游服务；不要提交密码、密钥或个人敏感信息。
- 公网前端可以直接调用，但容易暴露域名并消耗 Cloudflare 请求额度。
- 如果未来对外大规模开放，应在 Worker 前增加鉴权、速率限制、配额和日志脱敏。
- 第三方数据内容只用于展示或参考。关键业务决策必须使用具备正式授权和 SLA 的数据源。

## 9. 错误映射建议

| 情况 | 项目内部错误码建议 | 用户提示 |
| --- | --- | --- |
| 请求超时 | `UPSTREAM_TIMEOUT` | 数据服务响应超时，请稍后重试 |
| 网络失败 | `UPSTREAM_UNREACHABLE` | 暂时无法连接数据服务 |
| HTTP 429 | `UPSTREAM_RATE_LIMITED` | 请求过于频繁，请稍后重试 |
| HTTP 5xx | `UPSTREAM_ERROR` | 上游数据服务暂时异常 |
| JSON `code != 200` | `UPSTREAM_BUSINESS_ERROR` | 使用上游 `message` 的安全摘要 |
| 响应无法解析 | `UPSTREAM_INVALID_RESPONSE` | 数据服务返回格式异常 |

日志至少记录：接口路径、HTTP 状态、业务 `code`、耗时、重试次数和请求 ID。不要记录用户提交的完整敏感文本。

## 10. 上线前验收

### 10.1 最小冒烟测试

```bash
curl --fail --show-error \
  "https://your-60s-instance.example.com/health"

curl --fail --show-error \
  "https://your-60s-instance.example.com/endpoints"

curl --fail --show-error \
  "https://your-60s-instance.example.com/v2/60s"

curl --fail --show-error --get \
  --data-urlencode "query=北京" \
  "https://your-60s-instance.example.com/v2/weather/realtime"
```

### 10.2 当前验证记录

验证日期：2026-08-10。

| 接口 | 结果 | 内容类型 |
| --- | --- | --- |
| `/health` | HTTP 200 | `text/plain` |
| `/` | HTTP 200 | `application/json` |
| `/endpoints` | HTTP 200 | `application/json` |
| `/v2/60s` | HTTP 200 | `application/json` |
| `/v2/60s?encoding=text` | HTTP 200 | `text/plain` |
| `/v2/60s/rss` | HTTP 200 | `application/xml` |
| `/v2/bing` | HTTP 200 | `application/json` |
| `/v2/weibo` | HTTP 200 | `application/json` |
| `/v2/zhihu` | HTTP 200 | `application/json` |
| `/v2/weather/realtime?query=北京` | HTTP 200 | `application/json` |
| `/v2/qrcode?text=Hello&encoding=image` | HTTP 200 | `image/gif` |

## 11. 文档维护规则

出现以下任一情况时更新本文：

- Worker 域名、名称或鉴权方式变化；
- 重新部署上游新版本；
- `/endpoints` 清单发生变化；
- 已依赖接口的参数或响应字段发生变化；
- 接入了新的生产接口；
- 发现某接口长期失效或需要降级。

更新步骤：

1. 查询 `GET /health` 和 `GET /endpoints`。
2. 对项目实际依赖的每个接口执行真实请求。
3. 比较官方文档和自建实例的实际行为。
4. 更新部署版本、验证日期、接口字段和测试记录。
5. 运行调用方测试，确认错误处理和降级行为。

## 12. 资料优先级

发生冲突时按以下顺序判断：

1. 自建实例的真实响应与 `/endpoints`；
2. 当前部署源码：<https://github.com/vikiboss/60s>；
3. 官方 API 文档：<https://docs.60s-api.viki.moe>；
4. 本文中的历史验证记录。

本文是接入规范，不是完整 API 字段镜像。未写明的接口参数必须查阅官方文档并在自建实例上验证后使用。
