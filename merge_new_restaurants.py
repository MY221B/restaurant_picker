import pandas as pd
import sys
import os
import glob

# ============================================================
# 用法：
#   python merge_new_restaurants.py
#   或指定新数据文件：
#   python merge_new_restaurants.py 新餐厅数据/26年3月2日dianping.csv
#
# 功能：
#   1. 读取新爬取的大众点评 CSV（列名为 J_shopt / mode-tc）
#   2. 重命名列名，使其与主文件格式一致
#   3. 与主文件去重（按 J_shopt href 判断是否已存在）
#   4. 将新行追加到主工作文件 rest_data_process/restaurants.csv
# ============================================================

MASTER_FILE = 'rest_data_process/restaurants.csv'
NEW_DATA_DIR = '新餐厅数据'

def find_new_data_file():
    """自动寻找新餐厅数据目录下最新的 CSV 文件"""
    pattern = os.path.join(NEW_DATA_DIR, '*.csv')
    files = glob.glob(pattern)
    if not files:
        print(f'错误：在 {NEW_DATA_DIR}/ 目录下找不到 CSV 文件')
        sys.exit(1)
    # 按文件修改时间排序，取最新的
    latest = max(files, key=os.path.getmtime)
    return latest


def main():
    # 确定新数据文件路径
    if len(sys.argv) > 1:
        new_file = sys.argv[1]
    else:
        new_file = find_new_data_file()

    print(f'读取新数据：{new_file}')

    # 读取新数据
    new_df = pd.read_csv(new_file)
    print(f'新数据共 {len(new_df)} 行')
    print(f'新数据列名：{list(new_df.columns)}')

    # 重命名列：大众点评爬虫原始列名 → 主文件列名
    rename_map = {}
    if 'J_shopt' in new_df.columns:
        rename_map['J_shopt'] = '名称'
    if 'mode-tc' in new_df.columns:
        rename_map['mode-tc'] = '地址'
    if rename_map:
        new_df = new_df.rename(columns=rename_map)
        print(f'已重命名列：{rename_map}')

    # 检查必要列是否存在
    required_cols = ['名称', 'J_shopt href', '地址', 'city']
    missing = [c for c in required_cols if c not in new_df.columns]
    if missing:
        print(f'错误：新数据缺少必要列：{missing}')
        sys.exit(1)

    # 读取主文件
    master_df = pd.read_csv(MASTER_FILE)
    print(f'主文件现有 {len(master_df)} 行')

    # 去重：以 J_shopt href 为唯一键
    existing_urls = set(master_df['J_shopt href'].dropna())
    new_rows = new_df[~new_df['J_shopt href'].isin(existing_urls)].copy()
    duplicate_count = len(new_df) - len(new_rows)
    print(f'去重后：新增 {len(new_rows)} 行，跳过重复 {duplicate_count} 行')

    if len(new_rows) == 0:
        print('没有新数据需要添加，退出。')
        return

    # 对齐列：新行中没有的主文件列，填充为空
    for col in master_df.columns:
        if col not in new_rows.columns:
            new_rows[col] = None

    # 按主文件列顺序排列，多余的列放在末尾
    master_cols = list(master_df.columns)
    extra_cols = [c for c in new_rows.columns if c not in master_cols]
    new_rows = new_rows[master_cols + extra_cols]

    # 合并并写回主文件
    result_df = pd.concat([master_df, new_rows], ignore_index=True)
    result_df.to_csv(MASTER_FILE, index=False)
    print(f'\n完成！主文件现有 {len(result_df)} 行（新增 {len(new_rows)} 行）')
    print(f'已保存到：{MASTER_FILE}')
    print('\n下一步：运行经纬度获取脚本')
    print('  python rest_data_process/restaurants_lat_long.py')


if __name__ == '__main__':
    main()
