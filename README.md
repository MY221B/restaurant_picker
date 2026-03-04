# 餐厅随机推荐器

从个人大众点评收藏夹中随机推荐一家餐厅，支持按城市和驾车距离/时间筛选。

---

## 网页功能

打开网站后，用户可以：

- **输入位置**：手动输入地址，或点击定位按钮自动获取当前位置
- **选择城市**：从下拉菜单选择要筛选的城市（北京、西安、西雅图等）
- **设置距离上限**：通过滑块调整最远驾车时间（分钟）
- **点击"今天吃什么"**：从符合条件的餐厅中随机抽取一家，显示餐厅名称、地址、驾车距离/时间、预估打车费，以及大众点评链接
- **查看历史记录**：页面底部记录本次会话的所有抽签结果

### 距离计算逻辑

网站使用两种距离计算方式：

1. **预计算驾车距离（优先）**：CSV 文件中预先存储了从几个固定起点出发到各餐厅的驾车距离/时间。若用户位置距离某个起点在 30 分钟以内，则直接使用该列的数据进行筛选，无需实时调用 API。
2. **直线距离兜底**：若用户位置距所有预计算起点都超过 30 分钟，则通过后台 Web Worker 用 Haversine 公式计算用户到各餐厅的直线距离，以此筛选。

最终随机抽中后，会实时调用高德驾车路线 API 计算精确距离。

---

## 项目文件结构

```
new_look_picker/
├── index.html                    # 网页主界面
├── script.js                     # 前端核心逻辑（数据加载、筛选、随机抽取）
├── distanceWorker.js             # Web Worker：后台计算直线距离（Haversine）
├── styles.css                    # Tailwind 源样式
├── output.css                    # 编译后的 CSS（不要手动编辑）
├── tailwind.config.js
├── postcss.config.js
│
├── merge_new_restaurants.py      # 【数据更新】步骤1：融合新爬取数据
├── distance.js                   # 【数据更新】步骤3：批量计算驾车距离
│
├── rest_data_process/
│   ├── restaurants.csv           # 主数据文件（所有餐厅 + 预计算距离列）
│   └── restaurants_lat_long.py   # 【数据更新】步骤2：获取餐厅经纬度
│
├── 新餐厅数据/                    # 放置每次新爬取的大众点评原始 CSV
│   └── *.csv
│
└── rest_data_demo/               # 示例/参考数据，不参与实际流程
```

---

## 数据文件格式

### 主数据文件（`rest_data_process/restaurants.csv`）

这是整个系统的核心数据文件，也是最终上传到 Supabase 供网页读取的文件。

| 列名 | 说明 | 示例 |
|---|---|---|
| `名称` | 餐厅名称 | 散步去 |
| `J_shopt href` | 大众点评完整链接 | https://www.dianping.com/shop/... |
| `地址` | 街道地址（不含城市名） | 永定门东街9号 |
| `city` | 城市（含方括号） | [北京] |
| `经纬度` | 高德坐标，"经度,纬度"格式 | 116.405892,39.873471 |
| `tel` | 电话 | 13146503160 |
| `time` | 收藏时间 | 2025/1/8 20:09 |
| `{起点地址}距离` | 预计算驾车距离 | 13.27 km |
| `{起点地址}时间` | 预计算驾车时间 | 24 min |

距离/时间列的列名格式为起点地址字符串，例如：
- `北京树村丽景苑距离` / `北京树村丽景苑时间`
- `北京海淀区万家灯火大厦距离` / `北京海淀区万家灯火大厦时间`
- `北京建外soho西区距离` / `北京建外soho西区时间`

### 大众点评原始爬取数据（`新餐厅数据/*.csv`）

从大众点评爬取的原始格式，列名与主文件不同，需要经过 `merge_new_restaurants.py` 处理后才能使用：

| 原始列名 | 对应主文件列名 |
|---|---|
| `J_shopt` | `名称` |
| `mode-tc` | `地址` |
| `J_shopt href` | `J_shopt href`（相同） |
| `city` | `city`（相同） |
| `tel` | `tel`（相同） |
| `time` | `time`（相同） |

---

## 数据流总览

```
大众点评爬虫
    │
    ▼
新餐厅数据/*.csv
（原始格式：J_shopt, mode-tc 列名）
    │
    ▼  python merge_new_restaurants.py
    │  · 重命名列名（J_shopt→名称，mode-tc→地址）
    │  · 与主文件按 J_shopt href 去重
    │  · 追加新行（经纬度/距离列留空）
    ▼
rest_data_process/restaurants.csv（追加新行后）
    │
    ▼  python rest_data_process/restaurants_lat_long.py
    │  · 跳过已有经纬度的行
    │  · 调用高德 geocode API 填充经纬度
    │  · 每 50 行自动保存（支持断点续传）
    ▼
rest_data_process/restaurants.csv（经纬度已填充）
    │
    ▼  node distance.js（每个起点地址运行一次）
    │  · 跳过该列已有数据的行
    │  · 调用高德驾车路线 API 计算距离/时间
    │  · 将结果合并写回原文件
    ▼
rest_data_process/restaurants.csv（最终完整文件）
    │
    ▼  手动上传至 Supabase Storage
    │  路径：restaurants-data/restaurants.csv
    ▼
网页（script.js 从 Supabase URL 加载 CSV）
```

---

## 增加新餐厅数据的操作步骤

### 一键更新（推荐）

将新 CSV 放入 `新餐厅数据/` 后，直接运行：

```bash
bash update.sh
```

脚本会依次完成：合并数据 → 获取经纬度 → 计算驾车距离 → 推送到 GitHub。任意步骤失败时自动停止。

每次的完整流程只需要一行：
bash update.sh

脚本会按顺序自动完成所有步骤：
步骤	动作
1/3	merge_new_restaurants.py — 合并新数据
2/3	restaurants_lat_long.py — 获取经纬度
3/3	distance.js — 计算驾车距离 + 推送到 GitHub
有一点要注意：distance.js 里起点地址是写死的（目前是 北京建外soho西区），每次计算的是同一个起点。如果你需要换起点，还是要手动改一下 distance.js 底部的参数，然后再跑 bash update.sh。

---

### 分步执行（需要调试时使用）

### 前置条件

- Python 3 + pandas、requests 库
- Node.js + papaparse 包（首次使用运行 `npm install`）
- 网络可访问 `restapi.amap.com`（高德 API）

### 第 1 步：放入新数据

将新爬取的大众点评 CSV 文件放入 `新餐厅数据/` 目录。脚本会自动选取该目录下**修改时间最新**的 CSV 文件。

### 第 2 步：融合新数据

```bash
python merge_new_restaurants.py
```

输出示例：
```
新增 1715 行，跳过重复 80 行
主文件现有 4977 行
```

### 第 3 步：获取经纬度

```bash
python rest_data_process/restaurants_lat_long.py
```

- 只处理 `经纬度` 列为空的行，已有坐标的行自动跳过
- 每 50 行保存一次，中断后重跑会从断点继续，**不会重复处理**
- 海外餐厅（西雅图、京都等）通常无法被高德解析，会显示"无法获取坐标"，属于正常现象

### 第 4 步：计算驾车距离

修改 `distance.js` 文件末尾的参数，指定起点地址，然后运行：

```bash
node distance.js
```

- 只处理该距离列为空的行，已计算过的行自动跳过
- 每个起点地址需要单独运行一次
- 若需要多个起点，取消文件末尾注释后逐一运行

**切换起点地址示例**（编辑 `distance.js` 末尾）：
```javascript
calculateDistances(
    '北京树村丽景苑',      // 起点地址（会成为列名前缀）
    '北京',                // 只处理该城市的餐厅
    'rest_data_process/restaurants.csv',
    'rest_data_process/restaurants.csv'
);
```

### 第 5 步：上传到 Supabase

将 `rest_data_process/restaurants.csv` 上传至 Supabase Storage，**覆盖**原文件：
- Bucket：`restaurants-data`
- 文件名：`restaurants.csv`

上传后网站自动生效，无需重启或重新部署。

---

## 管理起点地址（预计算距离列）

### 添加新起点

在 `distance.js` 末尾设置新地址后运行。脚本会自动在 CSV 中新增两列（`{地址}距离` 和 `{地址}时间`），并计算所有该城市餐厅的数据。

### 停用旧起点

如果不再需要某个起点（例如搬家），有两种处理方式：

**方式 A：保留列但停止更新**——旧数据仍保留在文件中，不影响网站使用，只是数据不再更新。

**方式 B：将旧列改为新起点**——用 Python 一行命令重命名列并清空旧值，然后重新运行 `distance.js`：

```bash
python3 - <<'EOF'
import csv

old = '旧起点地址'
new = '新起点地址'
f = 'rest_data_process/restaurants.csv'

with open(f, 'r', encoding='utf-8') as fp:
    rows = list(csv.DictReader(fp))
    fp.seek(0)
    headers = next(csv.reader(fp))

new_headers = [new+'距离' if h==old+'距离' else new+'时间' if h==old+'时间' else h for h in headers]

with open(f, 'w', encoding='utf-8', newline='') as fp:
    w = csv.DictWriter(fp, fieldnames=new_headers)
    w.writeheader()
    for row in rows:
        new_row = {}
        for h, nh in zip(headers, new_headers):
            new_row[nh] = '' if (nh == new+'距离' or nh == new+'时间') else row.get(h,'')
        w.writerow(new_row)
print('完成')
EOF
```

---

## API 使用说明

整个项目使用同一个高德地图 API Key（在各脚本顶部定义）。涉及的接口：

| 接口 | 用途 | 使用位置 |
|---|---|---|
| `/v3/geocode/geo` | 地址 → 经纬度 | `restaurants_lat_long.py`、`distance.js`、`script.js` |
| `/v3/geocode/regeo` | 经纬度 → 城市名（反地理编码） | `script.js`（自动定位时） |
| `/v3/direction/driving` | 计算驾车路线距离/时间/费用 | `distance.js`、`script.js` |

`distanceWorker.js` 不调用任何 API，纯数学计算（Haversine 公式）。

---

## 样式开发

若修改了 `styles.css`，需要重新编译 Tailwind：

```bash
npx tailwindcss -i ./styles.css -o ./output.css
# 开发时监听模式：
npx tailwindcss -i ./styles.css -o ./output.css --watch
```
