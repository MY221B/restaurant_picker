const Papa = require('papaparse');
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

// ============================================================
// 用法（在底部修改参数后运行）：
//   node distance.js
//
// 功能：
//   1. 读取主 CSV 文件中指定城市的行
//   2. 只对「距离列为空」的行调用高德 API 计算驾车距离/时间
//      （已有数据的行自动跳过，不重复请求）
//   3. 将结果合并写回原文件（保留所有城市的行不变）
//
// 每次运行只处理一个城市 + 一个起点地址。
// 如需为多个起点计算，在底部多次调用 calculateDistances。
// ============================================================

const API_KEY = 'd111bbe935342b4ac8d1707ff6523552';
const RATE_LIMIT = 25; // 每批处理数量，避免超出 API 频率限制

function calculateDistances(inputAddress, selectedCity, inputFilePath, outputFilePath) {
    const distanceColName = `${inputAddress}距离`;
    const timeColName = `${inputAddress}时间`;

    getUserPosition(inputAddress)
        .then(userPosition => {
            if (!userPosition) {
                console.error('无法获取起点坐标，请检查地址是否正确');
                return;
            }

            const fileContent = fs.readFileSync(inputFilePath, 'utf8');
            const parsedData = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
            const allData = parsedData.data;

            // 只处理目标城市中距离列为空的行
            const toProcess = allData.filter(row => {
                const cityMatch = row['city'] && row['city'].replace(/[\[\]]/g, '') === selectedCity;
                const missingDistance = !row[distanceColName] || row[distanceColName].trim() === '';
                return cityMatch && missingDistance;
            });

            const alreadyDone = allData.filter(row => {
                const cityMatch = row['city'] && row['city'].replace(/[\[\]]/g, '') === selectedCity;
                const hasDistance = row[distanceColName] && row[distanceColName].trim() !== '';
                return cityMatch && hasDistance;
            }).length;

            console.log(`城市：${selectedCity}，起点：${inputAddress}`);
            console.log(`已有数据（跳过）：${alreadyDone} 家`);
            console.log(`需要计算：${toProcess.length} 家`);

            if (toProcess.length === 0) {
                console.log('没有需要更新的行，退出。');
                return;
            }

            processInBatches(toProcess, userPosition, inputAddress)
                .then(updatedRows => {
                    // 用 J_shopt href 作为唯一键，将更新后的行合并回全量数据
                    const updatedMap = new Map(
                        updatedRows.map(r => [r['J_shopt href'], r])
                    );

                    const finalData = allData.map(row =>
                        updatedMap.has(row['J_shopt href'])
                            ? updatedMap.get(row['J_shopt href'])
                            : row
                    );

                    const csv = Papa.unparse(finalData);
                    fs.writeFileSync(outputFilePath, csv);

                    const successCount = updatedRows.filter(r => r[distanceColName] !== 'N/A' && r[distanceColName] !== 'Error').length;
                    console.log(`\n完成！成功计算 ${successCount} 家，失败/无效 ${updatedRows.length - successCount} 家`);
                    console.log(`已写入：${outputFilePath}`);
                    console.log('\n下一步：上传更新后的文件到 Supabase Storage');
                    console.log('  路径：restaurants-data/restaurants.csv');
                    gitCommitAndPush(outputFilePath);
                });
        })
        .catch(err => {
            console.error('起点地址解析失败：', err.message);
        });
}

function processInBatches(data, userPosition, inputAddress, batchSize = RATE_LIMIT) {
    let results = [];
    let index = 0;

    function processBatch() {
        const batch = data.slice(index, index + batchSize);
        index += batchSize;

        const promises = batch.map(row => {
            const cityName = row['city'] ? row['city'].replace(/[\[\]]/g, '') : '';
            const restaurantAddress = `${cityName}${row['地址']}`;
            return getRestaurantDistance(userPosition, restaurantAddress)
                .then(distance => ({
                    ...row,
                    [`${inputAddress}距离`]: distance ? `${(distance.distance / 1000).toFixed(2)} km` : 'N/A',
                    [`${inputAddress}时间`]: distance ? `${Math.round(distance.duration / 60)} min` : 'N/A'
                }))
                .catch(error => {
                    console.error(`处理失败：${row['名称']}`, error.message);
                    return {
                        ...row,
                        [`${inputAddress}距离`]: 'Error',
                        [`${inputAddress}时间`]: 'Error'
                    };
                });
        });

        return Promise.all(promises)
            .then(batchResults => {
                results = results.concat(batchResults);
                const progress = Math.min(index, data.length);
                console.log(`进度：${progress} / ${data.length}`);
                if (index < data.length) {
                    return new Promise(resolve => setTimeout(() => resolve(processBatch()), 1000));
                }
                return results;
            });
    }

    return processBatch();
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function getUserPosition(address) {
    const geocodeUrl = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&output=json&key=${API_KEY}`;
    return httpsGet(geocodeUrl)
        .then(data => {
            if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
                const location = data.geocodes[0].location.split(',');
                return {
                    lng: parseFloat(location[0]),
                    lat: parseFloat(location[1])
                };
            }
            throw new Error('地址解析失败');
        });
}

function getRestaurantDistance(origin, destinationAddress) {
    const geocodeUrl = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(destinationAddress)}&output=json&key=${API_KEY}`;
    return httpsGet(geocodeUrl)
        .then(data => {
            if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
                const location = data.geocodes[0].location;
                const drivingUrl = `https://restapi.amap.com/v3/direction/driving?origin=${origin.lng},${origin.lat}&destination=${location}&extensions=base&key=${API_KEY}`;
                return httpsGet(drivingUrl);
            }
            throw new Error('餐厅地址解析失败');
        })
        .then(drivingData => {
            if (drivingData.status === '1' && drivingData.route && drivingData.route.paths && drivingData.route.paths.length > 0) {
                const route = drivingData.route.paths[0];
                return {
                    distance: parseFloat(route.distance),
                    duration: parseFloat(route.duration)
                };
            }
            throw new Error('路线规划失败');
        });
}

// ============================================================
// 数据更新完成后，自动 git commit + push 到远程仓库
// ============================================================
function gitCommitAndPush(filePath) {
    try {
        const today = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).replace(/\//g, '-');
        console.log('\n正在自动推送到远程仓库...');
        execSync(`git add "${filePath}"`, { stdio: 'inherit' });
        execSync(`git commit -m "数据更新：${today}"`, { stdio: 'inherit' });
        execSync('git push origin main', { stdio: 'inherit' });
        console.log('推送完成！');
    } catch (err) {
        console.error('自动推送失败：', err.message);
        console.log('请手动运行：git add rest_data_process/restaurants.csv && git commit -m "数据更新" && git push origin main');
    }
}

// ============================================================
// 在这里修改参数后运行：node distance.js
//
// 参数说明：
//   第 1 个：起点地址（会成为 CSV 列名的前缀，如 "北京树村丽景苑距离"）
//   第 2 个：城市名称（只处理该城市的行，需与 CSV 中 city 列的值去掉括号后一致）
//   第 3 个：输入文件路径
//   第 4 个：输出文件路径（可以和输入相同，直接覆盖）
//
// 当前激活的起点：北京建外soho西区
// ============================================================
calculateDistances(
    '北京建外soho西区',
    '北京',
    'rest_data_process/restaurants.csv',
    'rest_data_process/restaurants.csv'
);

// 如需同时计算多个起点，取消下面的注释并修改参数：
// calculateDistances(
//     '北京树村丽景苑',
//     '北京',
//     'rest_data_process/restaurants.csv',
//     'rest_data_process/restaurants.csv'
// );
// calculateDistances(
//     '北京海淀区万家灯火大厦',
//     '北京',
//     'rest_data_process/restaurants.csv',
//     'rest_data_process/restaurants.csv'
// );
