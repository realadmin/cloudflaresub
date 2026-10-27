<h1 align="center">
  <img src="./public/icons/auto.svg" alt="CloudflareSub Logo" height="40" align="absmiddle" /> CloudflareSub
</h1>

<p align="center"><em>一个轻量化的优选IP订阅器</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-2ea44f" alt="License MIT" />
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Windows" />
  <img src="https://img.shields.io/badge/platform-macOS-111111" alt="macOS" />
  <img src="https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black" alt="Linux" />
  <img src="https://img.shields.io/badge/runtime-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/status-active-00C853" alt="Status Active" />
</p>

一个部署在 **Cloudflare Pages** 上的轻量小工具：把你自建节点的链接（vmess / vless / trojan）粘贴进来，再填上 Cloudflare 优选 IP 或优选域名，它会自动把节点里的服务器地址替换成优选地址，生成一条**专属订阅链接**。把这条链接导入 V2rayN、Clash、Shadowrocket、Surge 等客户端，就能一键导入全部“换好优选 IP”的节点；以后优选 IP 变了，回来重新生成一次即可，客户端那边不用动。

> 本项目基于 [InfiCheesy/cloudflaresub](https://github.com/InfiCheesy/cloudflaresub) 修改：原项目是 Cloudflare Workers 版本，本版本迁移到了 Cloudflare Pages，并增加了明文链接输出、条目备注、有效期管理、KV 条目管理后台等功能。感谢原作者。

---

## 下载（要用哪个包看这里）

到本仓库的 **[Releases](../../releases)** 页面下载，每个版本都有两个现成的包，**不用自己从源码制作**：

| 包 | 给谁用 |
|---|---|
| `cloudflaresub-pages-upload.zip` | 想在 Cloudflare Pages 里**直接上传**部署的人（下方方式 A） |
| `cloudflaresub-pages.zip` | 想保存整份源码、或走 Git 连接部署的人（下方方式 B 用仓库代码即可，这个包只是离线备份） |

> 仓库里看到的是源码形态（`public/`、`src/` 等文件夹），那是给开发和 Git 部署用的；直传用的扁平包在 Releases 里下现成的就行。

## 功能一览

- **三种节点协议**：vmess://、vless://、trojan://，也支持直接粘贴一整段 base64 订阅内容自动解析
- **优选地址自由填**：IPv4、域名、带端口的地址、IPv6（裸地址或 `[IPv6]:端口`）都支持，一行一个，每个优选地址都会生成一组节点
- **多种输出格式**：自动识别（按客户端类型返回）、V2rayN（base64）、Clash（YAML）、Surge（Profile）、**明文链接**（一行一个节点链接，肉眼可读）
- **短链订阅**：生成结果存入 Cloudflare KV，只给你一条 `/sub/xxxx` 短链接；同一批内容重复生成会得到同一条链接
- **条目备注**：每条订阅可以写备注（比如哪台 VPS 生成的），日后一眼认出
- **有效期可选**：永久保存，或自定义天数（1–3650 天）到期自动删除；已生成的条目也能随时改期限
- **条目管理后台**：网页底部自带 KV 条目管理，可改备注、展开查看每条的全部客户端链接、修改有效期、按时间/名称/剩余期限排序、一键展开/收起全部、删除条目
- **手机友好**：全站针对触摸屏优化，大按钮、大输入框

---

## 部署教程（小白版）

只需要一个 Cloudflare 账号（免费即可）。两种部署方式二选一：**方式 A 直传文件**最简单，不需要 GitHub；**方式 B 连接 GitHub** 适合想长期维护代码的人。

部署完成后，需要给项目加两样东西，缺一不可：

1. **KV 命名空间绑定**：保存订阅数据的“仓库”
2. **访问令牌 `SUB_ACCESS_TOKEN`**：管理条目时用的密码，自己随便定一个长一点的字符串，记牢

具体加法在每个方式的最后几步里。

### 方式 A：直接上传（推荐新手）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，左侧点 **Workers 和 Pages**（Workers & Pages）
2. 点 **创建（Create）** → 选 **Pages** 标签页 → **上传资产（Upload assets）**
   - ⚠️ 一定要选 Pages 这条路。选错到 Workers 上传通道会得到一个“纯静态 Worker”，加不了下面的绑定，页面还会报错
3. 给项目起个名字（比如 `my-sub`），点创建
4. 先去本仓库的 **[Releases](../../releases)** 页面下载 `cloudflaresub-pages-upload.zip` 并解压，把**解压后的全部文件**（注意：是解压后文件夹里面的文件，不是文件夹本身；也不要用整仓库版的 zip）拖进上传框，点 **部署（Deploy）**
5. 部署完成后，进入该项目 → **设置（Settings）→ 绑定（Bindings）→ 添加（Add）**：选 **KV 命名空间**，变量名填 `SUB_STORE`（必须一字不差），命名空间没有就新建一个再选它
6. 同样在 **设置 → 变量和机密（Variables and secrets）→ 添加**：变量名填 `SUB_ACCESS_TOKEN`，值填你自定的令牌（建议选“机密 / Secret”类型）
7. ⚠️ **关键一步**：绑定和变量加完之后，要对新部署才生效。回到项目的 **部署（Deployments）** 页，点 **创建新部署（Create a new deployment）**，重新上传一次同样的文件部署
8. 打开项目给的 `https://你的项目名.pages.dev` 网址，能打开页面就是部署成功了

### 方式 B：连接 GitHub 仓库

1. 先把本仓库的代码传到你自己的 GitHub 仓库（fork 本仓库，或新建仓库把整仓库版文件传上去）
2. Cloudflare 控制台 → **Workers 和 Pages → 创建 → Pages → 连接到 Git（Connect to Git）**，选中你的仓库
3. 构建设置：框架预设选 **无（None）**，构建输出目录填 `public`，其他留空，点部署
4. 按方式 A 的第 5–7 步添加 KV 绑定 `SUB_STORE` 和变量 `SUB_ACCESS_TOKEN`，然后**重新部署一次**让绑定生效
5. 以后每次往 GitHub 仓库 push 新代码，Cloudflare 会自动重新部署

---

## 使用教程

### 生成订阅（四步）

打开你的站点，按页面顺序填：

1. **粘贴节点链接**：把自建节点的 vmess / vless / trojan 链接粘进来，一行一个；也可以直接粘一整段 base64 订阅内容
2. **粘贴优选 IP / 优选域名**：一行一个。支持的写法：
   - `104.16.0.1`（IPv4）
   - `104.16.0.1:8443`（带端口）
   - `bestcf.top`（优选域名）
   - `2606:4700:4700::1111`（IPv6 裸地址）
   - `[2606:4700:4700::1111]:443`（IPv6 带端口要加方括号）
   - 末尾可以用 `#备注` 给这一行单独起名
3. **可选设置**：
   - 名称前缀：给生成的一批节点统一加个前缀，方便在客户端里认
   - 保留原始域名和端口：勾上后优选地址只替换 IP 部分（少见需求，一般不勾）
   - 条目备注：写这条订阅是哪台 VPS、什么用途，如 `us-vps-1`，以后在管理区靠它认条目
   - 存储期限：**永久保存**（默认），或**自定义天数**，到期后 KV 自动删除这条订阅、链接随之失效
4. 点 **生成订阅**，下方“结果”区会出现订阅链接

### 把订阅导入客户端

结果区有几种格式卡片，每种都有 **复制** 和 **二维码** 两个按钮：

| 格式 | 用在哪 |
|---|---|
| 自动识别 | 通用首选，服务器会按客户端类型自动返回合适的格式 |
| V2rayN | V2rayN / v2rayNG |
| Clash | Clash / Mihomo / Clash Verge |
| Shadowrocket | iPhone / iPad 小火箭 |
| 明文链接 | 不是订阅，是逐行的节点明文链接；可以整段复制走，也能打开链接肉眼检查内容 |
| Surge | Surge 的 Profile 导入 |

导入方法都一样：在客户端里找“订阅”→“添加订阅”，粘贴链接保存，再点一次“更新订阅”即可。手机上也可以直接扫卡片上的二维码导入。

### 管理已生成的条目（页面底部“KV 条目管理”）

1. 在令牌框填入你部署时设的 `SUB_ACCESS_TOKEN`，点 **加载条目列表**
2. 每条订阅一行，能看到：备注、创建时间、有效期、来源 VPS / 节点、生成节点数
3. 每行四个按钮（两行两列）：
   - **链接 / 收起**：展开这条的全部客户端链接卡片（和结果区同款），在里面复制各格式链接或看明文
   - **存备注**：改完备注点它保存。按钮会先变成“保存中”，**回读 KV 确认真的存进去了**才显示“成功”（绿色，1.5 秒），失败则显示“失败”（红色），不会假报
   - **修改有效期**：展开行内面板，可把这条改成永久、或从现在起重新计时 N 天；保存同样有回读确认和成功/失败提示
   - **删除**：删除这条订阅，链接立即失效（会先弹确认框）
4. 列表上方还有：**排序**下拉（按创建时间正/倒序、按备注名正/倒序、按剩余有效期正/倒序）、**展开全部 / 收起全部**按钮
5. 小贴士：展开某条看链接时，往下翻这行会**吸在页面顶部**，方便随时收起；页面右下角有圆形按钮可一键回到顶部

### 订阅链接的规律（进阶）

- 链接形如 `https://你的域名/sub/<id>`，加参数可指定格式：`?target=raw`（base64）、`?target=clash`、`?target=surge`、`?target=plain`（明文）
- 同一批节点 + 同一批优选地址 + 同一名称前缀，重复生成得到的是**同一条链接**，且期限以最后一次生成的选择为准、重新计时
- 导入客户端时用结果区卡片给出的链接即可

---

## 常见问题

**打开网站报 1101 错误？**
多半是部署通道选错（部署到了 Workers 而不是 Pages），或文件不是最新版。按“方式 A”在 Pages 通道重新部署一次最新文件一般即可。

**设置里加不了绑定 / 绑定按钮是灰的？**
说明这个项目是“纯静态 Worker”，不是 Pages 项目。纯静态 Worker 天生没有脚本，加不了绑定。到 Workers 和 Pages 里新建一个 **Pages** 项目重来。

**管理区点加载提示令牌不正确（403）？**
检查三件事：令牌是不是和 `SUB_ACCESS_TOKEN` 一模一样（包括大小写、有没有多余空格）；加完变量后有没有**重新部署**；令牌框里粘贴时有没有带空格。

**刚改完备注 / 期限，列表里偶尔还是旧的？**
Cloudflare KV 是“最终一致”存储，跨地区同步偶尔要几秒。本站的确认和列表都直读记录本身，正常情况下点一次加载就会对上；若真遇到，隔几秒再加载一次即可。

**条目不见了 / 订阅打开 404？**
要么被手动删除了，要么它的有效期到期被 KV 自动清除了。重新生成一次即可（相同内容会得到同一条链接）。

**优选 IP 填了 IPv6 节点却坏了？**
IPv6 裸地址直接一行一个填就行；带端口必须写成 `[地址]:端口` 的方括号形式。

**令牌忘了怎么办？**
去 Pages 项目设置里看 `SUB_ACCESS_TOKEN`；机密类型看不到明文的话，就直接改一个新的，然后重新部署，再用新令牌。

---

## 本地开发

需要 Node.js 18+。

```bash
# 本地把站点跑起来（在仓库根目录）
npx wrangler pages dev public

# 跑测试（冒烟 + 接口全量用例）
npm run check
```

目录结构：

```text
cloudflaresub/
├─ public/           # 部署到 Pages 的全部运行文件（构建输出目录）
│  ├─ index.html     # 页面
│  ├─ app.js         # 前端逻辑
│  ├─ styles.css     # 样式
│  ├─ _worker.js     # Pages 入口（与 src/worker.js 保持内容一致）
│  └─ icons/         # 客户端图标
├─ src/
│  ├─ worker.js      # 服务端源码（改代码改这里，再同步到 public/_worker.js）
│  └─ core.js        # 解析/渲染核心函数（测试使用）
├─ tests/            # 自动化测试
├─ wrangler.toml     # Pages 项目配置
└─ package.json
```

## 安全提醒

- `SUB_ACCESS_TOKEN` 相当于管理密码，别写进代码、别提交到公开仓库、别发给别人；它只应该出现在 Cloudflare 项目设置里
- 本工具生成的订阅链接谁拿到谁就能用，请勿公开分享你的订阅链接
- 使用本工具请遵守当地法律法规和服务商条款

## 致谢与许可证

- 原项目：[InfiCheesy/cloudflaresub](https://github.com/InfiCheesy/cloudflaresub)
- 本项目以 [MIT 许可证](LICENSE) 发布
