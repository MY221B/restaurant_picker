import pandas as pd
import requests
import time

# 在 terminal 中运行：python rest_data_process/restaurants_lat_long.py
# 支持断点续传：每处理 50 行自动保存一次，中断后重跑会跳过已有经纬度的行

API_KEY = 'd111bbe935342b4ac8d1707ff6523552'
CSV_FILE = 'rest_data_process/restaurants.csv'
SAVE_INTERVAL = 50   # 每处理多少行保存一次
RETRY_TIMES = 3      # 网络错误时的重试次数
RETRY_DELAY = 5      # 重试间隔（秒）

def geocode(address_query):
    """调用高德 geocode API，含网络错误重试"""
    url = f"https://restapi.amap.com/v3/geocode/geo?address={requests.utils.quote(address_query)}&output=json&key={API_KEY}"
    for attempt in range(RETRY_TIMES):
        try:
            response = requests.get(url, timeout=10)
            data = response.json()
            if data['status'] == '1' and data.get('geocodes'):
                return data['geocodes'][0]['location']
            return None
        except requests.exceptions.RequestException as e:
            if attempt < RETRY_TIMES - 1:
                print(f'  网络错误，{RETRY_DELAY}s 后重试（第 {attempt + 1} 次）：{e}')
                time.sleep(RETRY_DELAY)
            else:
                print(f'  网络错误，已重试 {RETRY_TIMES} 次，跳过：{e}')
                return None

def get_lat_long(city, address, restaurant_name):
    # 去掉城市名中的方括号
    city_clean = str(city).replace('[', '').replace(']', '')

    # 第一次：城市 + 地址
    result = geocode(f"{city_clean}{address}")
    if result:
        return result

    # 第二次：城市 + 餐厅名称
    result = geocode(f"{city_clean}{restaurant_name}")
    if result:
        return result

    # 第三次：餐厅名称 + 地址
    result = geocode(f"{restaurant_name}{address}")
    if result:
        return result

    print(f'  无法获取坐标：{restaurant_name}')
    return None


# 读取 CSV
df = pd.read_csv(CSV_FILE)

if '经纬度' not in df.columns:
    df['经纬度'] = None

# 只处理经纬度为空的行
pending = df[df['经纬度'].isnull()].index.tolist()
total = len(pending)
print(f'需要处理：{total} 行（已有经纬度的行自动跳过）')

if total == 0:
    print('所有行均已有经纬度，无需处理。')
else:
    success_count = 0
    fail_count = 0

    for i, index in enumerate(pending, 1):
        row = df.loc[index]
        result = get_lat_long(row['city'], row['地址'], row['名称'])
        df.at[index, '经纬度'] = result
        if result:
            success_count += 1
        else:
            fail_count += 1

        # 进度提示
        if i % 50 == 0 or i == total:
            print(f'进度：{i}/{total}（成功 {success_count}，失败 {fail_count}）')

        # 断点续传：每 SAVE_INTERVAL 行保存一次
        if i % SAVE_INTERVAL == 0:
            df.to_csv(CSV_FILE, index=False)
            print(f'  [自动保存] 已写入 {CSV_FILE}')

    # 将经纬度列调整到第 5 列位置（如果不在的话）
    cols = list(df.columns)
    if '经纬度' in cols:
        cols.insert(4, cols.pop(cols.index('经纬度')))
        df = df[cols]

    df.to_csv(CSV_FILE, index=False)
    print(f'\n处理完成！成功：{success_count}，失败：{fail_count}')
    print(f'已保存到：{CSV_FILE}')
    print('\n下一步：运行驾车距离计算脚本')
    print('  node distance.js')
