// 运行 Tailwind CLI 命令：
// 在终端中输入以下命令以监视文件更改并编译 CSS：
// npx tailwindcss -i ./styles.css -o ./output.css --watch

// 全局变量
let restaurants = []; // 使用 let 而不是 const
let userPosition;
let savedLocations = [];
let nearestLocation;
let minDrivingTime = Infinity;
let directDistance = false;
let directDistances = [];
let userCity = null;
let initCount = 0;

// 真实驾车距离分阶段计算
let realDrivingMode = false;
let drivingDistances = {};   // { name: { distance(m), duration(s) } }
let phase1Complete   = false;
let phase2Complete   = false;
let phase2InProgress = false;
let drivingCalcAborted = false;  // 用户点击停止时设为 true
const PHASE1_MAX_KM      = 15;
const PHASE2_TRIGGER_MIN = 30;
const DEFAULT_DISTANCE_KM = 5;  // 直线距离模式下的默认距离（千米）
const NEAR_SAVED_LOCATION_KM = 2;  // 直线距离在此范围内视为在预存地址
const NEAR_SAVED_LOCATION_MIN = 15;  // 车程在此分钟内视为在预存地址（原10分钟可能因定位偏差过严）

const API_KEY = 'd111bbe935342b4ac8d1707ff6523552';
const SUPABASE_URL = 'https://tazccareqiurrsgfzong.supabase.co';
const SUPABASE_ANON_KEY = '';

// 在文件开头添加这些变量引用
let loadingMessage, errorMessage, restaurantCount;

// 将预存地址名称格式化为可读形式，如 "北京建外soho西区" -> "建外 SOHO 西区"
function formatSavedLocationName(locationKey) {
    if (!locationKey) return '';
    return locationKey
        .replace(/^北京|^上海|^广州|^深圳|^杭州|^成都|^西安|^南京|^武汉|^苏州|^天津|^重庆|^青岛|^大连|^厦门|^长沙|^沈阳|^济南|^哈尔滨|^福州|^郑州|^石家庄|^昆明|^南昌|^合肥|^太原|^长春|^南宁|^兰州|^贵阳|^海口|^银川|^西宁|^乌鲁木齐|^拉萨|^呼和浩特/g, '')
        .replace(/soho/gi, 'SOHO')
        .replace(/([a-zA-Z]+)/g, ' $1 ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 添加新的辅助函数：处理地址信息
function formatAddress(address, province, city) {
    let formattedAddress = address;
    
    if (province) {
        formattedAddress = formattedAddress.replace(province, '');
    }
    if (city) {
        formattedAddress = formattedAddress.replace(city, '');
    }
    // 去掉可能残留的多余空格和符号
    return formattedAddress.replace(/^[\s,，]*/, '');
}

// 修改 loadDefaultCSV 函数，在数据加载完成后调用 onCSVDataLoaded
function loadDefaultCSV() {
    return new Promise((resolve, reject) => {
        if (!loadingMessage || !restaurantCount || !errorMessage) {
            console.warn('DOM elements not found. Retrying in 100ms...');
            setTimeout(() => loadDefaultCSV().then(resolve).catch(reject), 100);
            return;
        }

        loadingMessage.classList.remove('hidden');
        restaurantCount.classList.add('hidden');
        errorMessage.classList.add('hidden');

        fetch(`${SUPABASE_URL}/storage/v1/object/public/restaurants-data/restaurants.csv`)
            .then(response => response.text())
            .then(csvData => {
                processCSVData(csvData);
                resolve();
            })
            .catch(error => {
                loadingMessage.classList.add('hidden');
                errorMessage.classList.remove('hidden');
                console.error('Error loading default CSV file:', error);
                reject(error);
            });
    });
}

function onCSVDataLoaded() {
    // 隐藏加载消息
    loadingMessage.classList.add('hidden');
    
    // 显示餐厅数量
    restaurantCount.classList.remove('hidden');
    
    updateCityList();
    updateRestaurantCount(); // 更新餐厅数量
    // 其他需在数据加载后执行的操作...
}

// 修改 processCSVData 函数，在数据处完成后调用 onCSVDataLoaded
function processCSVData(csvData) {
    Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            try {
                restaurants = results.data
                    .filter(row => row['名称'] && row['名称'].trim() !== '')
                    .map(row => ({
                        name: row['名称'] || '未提供',
                        url: convertToMobileUrl(row['J_shopt href']) || '#',
                        address: row['地址'] || '未提供',
                        city: formatCityName(row['city']), // 使用 formatCityName
                        tel: row['tel'] || '未提供',
                        time: row['time'] || '未提供',
                        ...row  // 保留所有原始数据
                    }));
                console.log('Restaurants data loaded:', restaurants.length);
                console.log('Sample restaurant data:', restaurants[0]); // 输出第一个餐厅的数据作为样本
                extractSavedLocations(restaurants);
                onCSVDataLoaded(); // 在这里调用 onCSVDataLoaded
            } catch (error) {
                console.error('Error processing CSV data:', error);
                errorMessage.classList.remove('hidden');
                loadingMessage.classList.add('hidden');
            }
        },
        error: function(error) {
            console.error('Error parsing CSV:', error);
            errorMessage.classList.remove('hidden');
            loadingMessage.classList.add('hidden');
        }
    });
}

// 从餐厅数据中提取存的位置信息
function extractSavedLocations(restaurants) {
    const locationSet = new Set();
    restaurants.forEach(restaurant => {
        Object.keys(restaurant).forEach(key => {
            if (key.endsWith('距离')) {
                const location = key.replace('距离', '');
                locationSet.add(location);
            }
        });
    });
    savedLocations = Array.from(locationSet);
    console.log('Extracted saved locations:', savedLocations);
    if (savedLocations.length === 0) {
        console.warn('No saved locations found in the data. Please check the CSV file format.');
    }
}

// 添加新的辅助函数
function updateLocationPlaceholder(address) {
    document.getElementById('location').placeholder = `已定位至${address}`;
}

// 请求用户的地理位置
function requestUserLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            userPosition = {
                lng: position.coords.longitude,
                lat: position.coords.latitude
            };
            console.log('User position:', userPosition);
            
            reverseGeocode(userPosition.lng, userPosition.lat)
                .then(result => {
                    console.log('User location:', result);
                    userCity = result.city;
                    updateCityList(result.city);
                    updateCitySelect(result.city);
                    updateDistanceFilterVisibility();
                    calculateNearestLocation(userPosition);
                    updateLocationPlaceholder(result.formatted_address);
                })
                .catch(error => {
                    console.error('Error in reverse geocoding:', error);
                    alert('无法获取城市信息，请手动选择城市。');
                    handleLocationFailure();
                });
        }, function(error) {
            console.error('Error getting user location:', error);
            handleLocationFailure();
        });
    } else {
        console.log("Geolocation is not supported by this browser.");
        handleLocationFailure();
    }
}

function handleLocationFailure() {
    userPosition = null;
    userCity = null;
    document.getElementById('location').placeholder = "无法获取位置，请手动选择城市";
    updateDistanceFilterVisibility();
    updateRestaurantCount();
}

// 修改 searchLocation 函数
function searchLocation(event) {
    console.log('searchLocation called', event ? event.type : 'manually');
    
    // 如果是由 focus 事件触发的，直接返回
    if (event && event.type === 'focus') {
        console.log('Ignoring focus event');
        return;
    }

    // 如果传入了事件对象，阻止默认行为
    if (event) {
        event.preventDefault();
    }

    const address = document.getElementById('location').value;

    if (!address) {
        console.log('No address entered, returning');
        return;
    }

    console.log('Searching for address:', address);

    const geocodeUrl = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&output=json&key=${API_KEY}`;
    
    fetch(geocodeUrl)
        .then(response => response.json())
        .then(data => {
            console.log('Geocode response:', data);
            if (data.status === '1' && data.geocodes.length > 0) {
                const geocode = data.geocodes[0];
                const location = geocode.location.split(',');
                userPosition = {
                    lng: parseFloat(location[0]),
                    lat: parseFloat(location[1])
                };
                console.log('User position updated:', userPosition);
                
                // 清空输入框的值
                document.getElementById('location').value = '';
                
                const formattedAddress = formatAddress(
                    geocode.formatted_address,
                    geocode.province,
                    geocode.city
                );
                
                updateLocationPlaceholder(formattedAddress);
                
                const city = geocode.city;
                userCity = formatCityName(city);
                console.log('User city:', city);
                updateCitySelect(city);
                updateDistanceFilterVisibility();
                
                alert('位置已更新');
                calculateNearestLocation(userPosition);
            } else {
                console.log('Unable to find location');
                alert('无法找到该位置，请尝试更详细的地址');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('位置搜索失败，请稍后重试');
        });
}

// 使用高德地图API进行逆地理编，将经纬度转换为城市名称
function reverseGeocode(lng, lat) {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${API_KEY}&location=${lng},${lat}&extensions=base`;
    
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.status === "1" && data.regeocode) {
                const addressComponent = data.regeocode.addressComponent;
                let city = addressComponent.city;
                
                if (!city || city.length === 0) {
                    city = addressComponent.province;
                }
                
                const formattedAddress = formatAddress(
                    data.regeocode.formatted_address,
                    addressComponent.province,
                    city
                );
                
                return {
                    city: formatCityName(city),
                    formatted_address: formattedAddress
                };
            } else {
                throw new Error('Unable to reverse geocode');
            }
        });
}

// 计算用户位置到所有保存位置的距离，找出最近的位置
function calculateNearestLocation(userPosition) {
    console.log('Calculating nearest location for user position:', userPosition);
    console.log('Number of saved locations:', savedLocations.length);
    
    if (savedLocations.length === 0) {
        console.error('No saved locations available. Cannot calculate nearest location.');
        return;
    }

    nearestLocation = null;
    minDrivingTime = Infinity;
    directDistance = false;
    realDrivingMode = false;
    drivingDistances = {};
    phase1Complete = phase2Complete = phase2InProgress = false;
    drivingCalcAborted = false;
    hideDrivingStatus();
    showCalcRealDrivingButton(false);

    const promises = savedLocations.map(location => {
        console.log('Processing location:', location);
        const geocodeUrl = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(location)}&output=json&key=${API_KEY}`;
        return fetch(geocodeUrl)
            .then(response => response.json())
            .then(data => {
                console.log('Geocode response for location:', location, data);
                if (data.status === '1' && data.geocodes.length > 0) {
                    const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
                    const drivingUrl = `https://restapi.amap.com/v3/direction/driving?origin=${userPosition.lng},${userPosition.lat}&destination=${lng},${lat}&extensions=base&key=${API_KEY}`;
                    return fetch(drivingUrl)
                        .then(response => response.json())
                        .then(data => {
                            console.log('Driving route response for location:', location, data);
                            if (data.status === '1' && data.route && data.route.paths && data.route.paths.length > 0) {
                                const drivingTime = parseInt(data.route.paths[0].duration) / 60;  // 转为分钟
                                console.log(`Driving time to ${location}: ${drivingTime} minutes`);
                                return { location, drivingTime, lat, lng };
                            }
                            console.log(`Unable to calculate driving time to ${location}`);
                            return { location, drivingTime: Infinity, lat, lng };
                        });
                }
                console.log(`Unable to geocode location: ${location}`);
                return null;
            })
            .catch(error => {
                console.error(`Error processing location ${location}:`, error);
                return null;
            });
    });

    Promise.all(promises)
        .then(results => {
            console.log('All location calculations completed. Results:', results);
            const validResults = results.filter(r => r);
            validResults.forEach(result => {
                if (result.drivingTime < minDrivingTime) {
                    minDrivingTime = result.drivingTime;
                    nearestLocation = result.location;
                }
            });
            let usePreSavedLocation = minDrivingTime <= NEAR_SAVED_LOCATION_MIN;
            if (!usePreSavedLocation) {
                // 车程超阈值时，检查直线距离：用户可能在预存地址附近（如建外 SOHO 西区）
                const R = 6371;
                const toRad = x => x * Math.PI / 180;
                const haversine = (lat1, lng1, lat2, lng2) => {
                    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
                    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
                    return 2 * R * Math.asin(Math.sqrt(a));
                };
                for (const r of validResults) {
                    if (r.lat != null && r.lng != null) {
                        const km = haversine(userPosition.lat, userPosition.lng, r.lat, r.lng);
                        if (km <= NEAR_SAVED_LOCATION_KM) {
                            nearestLocation = r.location;
                            usePreSavedLocation = true;
                            console.log(`使用直线距离匹配预存地址: ${r.location}, ${km.toFixed(2)} km`);
                            break;
                        }
                    }
                }
            }
            console.log(`Nearest location: ${nearestLocation}, Driving time: ${minDrivingTime} minutes`);

            if (!usePreSavedLocation) {
                nearestLocation = userPosition;
                directDistance = true;
                calculateDirectDistance(nearestLocation);
                console.log('计算直线距离');
            } else {
                updateLocationPlaceholder(formatSavedLocationName(nearestLocation));
            }

            updateTimeFilterUI();
            updateRestaurantCount();
        })
        .catch(error => {
            console.error('Error in calculateNearestLocation:', error);
        });
}

// 新增计算直线距离的函数
function calculateDirectDistance(nearestLocation) {
    const worker = new Worker('distanceWorker.js');
    worker.onmessage = function(event) {
        directDistances = event.data;
        console.log('Direct distances calculated:', directDistances);
        updateTimeFilterUI();
        updateRestaurantCount();
        showCalcRealDrivingButton(true);
    };
    
    const selectedCity = formatCityName(document.querySelector('.selected-city').textContent);
    const cityRestaurants = restaurants.filter(r => compareCityNames(formatCityName(r.city), selectedCity));
    
    worker.postMessage({ userPosition, restaurants: cityRestaurants });
    console.log('计算直线距离中');
}

// ── 真实驾车距离：辅助 UI ───────────────────────────────────────────
function showCalcRealDrivingButton(show) {
    const btn = document.getElementById('calc-real-driving');
    if (btn) btn.classList.toggle('hidden', !show);
}

function showDrivingStatus(msg) {
    const textEl = document.getElementById('driving-status-text');
    const statusEl = document.getElementById('driving-status');
    const fillEl = document.getElementById('driving-progress-fill');
    if (textEl) textEl.textContent = msg;
    if (statusEl) statusEl.classList.remove('hidden');
    if (fillEl) fillEl.style.width = '0%';
}

function showDrivingProgress(current, total, msg) {
    const textEl = document.getElementById('driving-status-text');
    const fillEl = document.getElementById('driving-progress-fill');
    if (textEl) textEl.textContent = msg || `已计算 ${current}/${total} 家`;
    if (fillEl && total > 0) fillEl.style.width = `${Math.round((current / total) * 100)}%`;
}

function hideDrivingStatus() {
    const el = document.getElementById('driving-status');
    if (el) el.classList.add('hidden');
}

// ── 真实驾车距离：Phase 1（直线 ≤ 15 km 的餐厅）───────────────────
function startRealDrivingPhase1() {
    drivingCalcAborted = false;
    const selectedCity = formatCityName(document.querySelector('.selected-city').textContent);
    const cityRestaurants = restaurants.filter(r =>
        compareCityNames(formatCityName(r.city), selectedCity) && r['经纬度']
    );
    const phase1List = cityRestaurants.filter(r => {
        const d = directDistances.find(dd => dd.name === r.name);
        return d && d.distance <= PHASE1_MAX_KM;
    });

    if (phase1List.length === 0) {
        phase1Complete = true;
        realDrivingMode = true;
        hideDrivingStatus();
        updateTimeFilterUI();
        updateRestaurantCount();
        return;
    }

    showDrivingStatus(`正在计算 ${phase1List.length} 家附近餐厅的真实车程...`);

    calcDrivingBatch(phase1List, 10, (done, total) => {
        showDrivingProgress(done, total, `已计算 ${done}/${total} 家餐厅的真实车程`);
    }).then(() => {
        phase1Complete = true;
        realDrivingMode = true;
        hideDrivingStatus();
        updateTimeFilterUI();
        updateRestaurantCount();
        console.log('Phase 1 complete, calculated:', Object.keys(drivingDistances).length);
    }).catch(err => {
        console.error('Phase 1 error:', err);
        hideDrivingStatus();
        updateTimeFilterUI();
        updateRestaurantCount();
    });
}

// ── 真实驾车距离：Phase 2（剩余餐厅，滑块 > 30 min 时触发）────────
function startRealDrivingPhase2() {
    if (phase2InProgress || phase2Complete) return;
    phase2InProgress = true;
    drivingCalcAborted = false;

    const selectedCity = formatCityName(document.querySelector('.selected-city').textContent);
    const cityRestaurants = restaurants.filter(r =>
        compareCityNames(formatCityName(r.city), selectedCity) && r['经纬度']
    );
    const phase2List = cityRestaurants.filter(r => !drivingDistances[r.name]);

    if (phase2List.length === 0) {
        phase2Complete = true;
        phase2InProgress = false;
        return;
    }

    showDrivingStatus(`正在扩大范围，计算剩余 ${phase2List.length} 家餐厅的车程...`);

    calcDrivingBatch(phase2List, 10, (done, total) => {
        showDrivingProgress(done, total, `已计算 ${done}/${total} 家餐厅的车程`);
    }).then(() => {
        phase2Complete = true;
        phase2InProgress = false;
        hideDrivingStatus();
        updateTimeFilterUI();
        updateRestaurantCount();
        console.log('Phase 2 complete, total calculated:', Object.keys(drivingDistances).length);
    }).catch(err => {
        console.error('Phase 2 error:', err);
        phase2InProgress = false;
        hideDrivingStatus();
        updateTimeFilterUI();
        updateRestaurantCount();
    });
}

// ── 真实驾车距离：批量调高德 API（每批 10 个并发）─────────────────
async function calcDrivingBatch(restaurantList, batchSize = 10, progressCallback) {
    const total = restaurantList.length;
    for (let i = 0; i < restaurantList.length; i += batchSize) {
        if (drivingCalcAborted) break;
        const batch = restaurantList.slice(i, i + batchSize);
        await Promise.all(batch.map(r => {
            const coords = r['经纬度']; // 高德格式：lng,lat
            const url = `https://restapi.amap.com/v3/direction/driving?origin=${userPosition.lng},${userPosition.lat}&destination=${coords}&extensions=base&key=${API_KEY}`;
            return fetch(url)
                .then(res => res.json())
                .then(data => {
                    if (data.status === '1' && data.route?.paths?.length > 0) {
                        const path = data.route.paths[0];
                        drivingDistances[r.name] = {
                            distance: parseFloat(path.distance),
                            duration: parseFloat(path.duration)
                        };
                    }
                })
                .catch(() => {});
        }));
        const done = Math.min(i + batchSize, total);
        if (progressCallback) progressCallback(done, total);
        if (realDrivingMode) updateRestaurantCount();
    }
}

// 获取餐厅的经纬度
function getRestaurantLocation(restaurant) {
    if (restaurant['经纬度']) {
        return Promise.resolve(restaurant['经纬度']);
    } else {
        const address = `${restaurant.city}${restaurant.address}`;
        const geocodeUrl = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&output=json&key=${API_KEY}`;
        console.log('Sending geocode request for restaurant:', geocodeUrl);
        return fetch(geocodeUrl)
            .then(response => response.json())
            .then(data => {
                console.log('Geocode response for restaurant:', data);
                if (data.status === '1' && data.geocodes.length > 0) {
                    return data.geocodes[0].location;
                } else {
                    console.log('Unable to geocode restaurant address');
                    throw new Error('无法解析餐厅地址');
                }
            })
            .catch(error => {
                console.error('Error in geocode request for restaurant:', error);
                throw error;
            });
    }
}

// 修改 getRestaurantLocationAndCalculateDistance 函数
function getRestaurantLocationAndCalculateDistance(restaurant) {
    console.log('Getting location for restaurant:', restaurant);
    getRestaurantLocation(restaurant)
        .then(location => {
            console.log('Restaurant location obtained:', location);
            if (userPosition) {
                calculateDistance(userPosition, location.split(','), restaurant)
                    .then(result => {
                        if (result) {
                            const { distance, duration, taxiCost } = result;
                            showRandomResult(restaurant, distance, duration, taxiCost);
                        } else {
                            showRandomResult(restaurant);
                        }
                    })
                    .catch(error => {
                        console.error('Error calculating distance:', error);
                        showRandomResult(restaurant);
                    });
            } else {
                showRandomResult(restaurant);
            }
        })
        .catch(error => {
            console.error('Error in geocode request for restaurant:', error);
            showRandomResult(restaurant);
        });
}

// 计算用户位置到餐厅的距离
function calculateDistance(origin, destination, restaurant) {
    console.log('Calculating distance from', origin, 'to', destination);
    const drivingUrl = `https://restapi.amap.com/v3/direction/driving?origin=${origin.lng},${origin.lat}&destination=${destination[0]},${destination[1]}&extensions=all&strategy=10&key=${API_KEY}`;
    
    console.log('Sending driving route request:', drivingUrl);
    return fetch(drivingUrl)
        .then(response => response.json())
        .then(data => {
            console.log('Driving route response:', data);
            if (data.status === '1' && data.route && data.route.paths && data.route.paths.length > 0) {
                const route = data.route.paths[0];
                const taxiCost = data.route.taxi_cost;
                console.log('Route found, distance:', route.distance, 'duration:', route.duration, 'taxi cost:', taxiCost);
                
                const distance = parseFloat(route.distance);
                const duration = parseFloat(route.duration);
                const cost = parseFloat(taxiCost);

                if (!isNaN(distance) && !isNaN(duration) && !isNaN(cost)) {
                    return { distance, duration, taxiCost };
                } else {
                    console.error('Invalid data received:', { distance, duration, taxiCost });
                    return null;
                }
            } else {
                console.log('Unable to calculate route');
                return null;
            }
        })
        .catch(error => {
            console.error('Error in driving route request:', error);
            return null;
        });
}

// 更新时间筛选器UI
function updateTimeFilterUI() {
    const filterContainer = document.querySelector('.distance-select');
    const slider = document.getElementById('distance');
    const valueDisplay = document.getElementById('distance-value');
    
    if (filterContainer && slider && valueDisplay) {
        if (nearestLocation) {
            filterContainer.style.display = 'block';
            if (directDistance) {
                if (realDrivingMode) {
                    const maxTime = Math.max(...Object.values(drivingDistances).map(d => d.duration / 60), 30);
                    slider.max = 120;
                    if (!slider.value || parseInt(slider.value) < 1) slider.value = Math.min(30, maxTime);
                    valueDisplay.textContent = `${slider.value} min 车程内`;
                    updateSliderBackground(slider);
                    updateRestaurantCount();
                    return;
                } else if (directDistances.length > 0) { // 确保有计算结果
                    const maxDistance = Math.max(...directDistances.map(d => d.distance));
                    slider.max = Math.min(40, maxDistance); // 设置最大直线距离
                    slider.value = DEFAULT_DISTANCE_KM; // 默认 5 千米
                    valueDisplay.textContent = `${slider.value} km 直线距离内`; // 更新单位
                } else {
                    filterContainer.style.display = 'none'; // 如果没有计算结果，隐藏滑块
                }
            } else {
                // 现有逻辑
                const timeColumn = `${nearestLocation}时间`;
                const times = restaurants.map(r => parseInt(r[timeColumn])).filter(t => !isNaN(t));
                const maxTime = Math.max(...times);
                slider.max = Math.min(120, maxTime);
                let defaultValue = maxTime < 30 ? Math.round(maxTime / 2) : 30;
                slider.value = defaultValue;
                valueDisplay.textContent = `${defaultValue} min 车程内`;
            }
            console.log('Time filter UI updated');
            updateRestaurantCount(); // 更新餐厅数量
        } else {
            filterContainer.style.display = 'none';
            console.log('Time filter UI hidden: nearestLocation not set');
        }
    } else {
        console.warn('Time filter UI elements not found');
    }
}

// 更新滑块显示
function updateSlider() {
    const slider = document.getElementById('distance');
    const output = document.getElementById('distance-value');
    if (slider && output) {
        const value = parseInt(slider.value);
        if (realDrivingMode) {
            output.textContent = `${value} min 车程内`;
            if (!phase2Complete && !phase2InProgress && value > PHASE2_TRIGGER_MIN) {
                startRealDrivingPhase2();
            }
        } else {
            output.textContent = directDistance ? `${value} km 直线距离内` : `${value} min 车程内`;
        }
        // 更新滑块的背景颜色
        updateSliderBackground(slider);
        console.log('Slider updated:', value);
        
        // 每次滑块更新时都更新餐厅计数
        updateRestaurantCount();
    } else {
        console.warn('Slider elements not found');
    }
}

// 新增函数：更新滑块背景
function updateSliderBackground(slider) {
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    const value = parseInt(slider.value);
    const percentage = ((value - min) / (max - min)) * 100;
    const backgroundStyle = `linear-gradient(to right, #007AFF 0%, #007AFF ${percentage}%, #D1D1D6 ${percentage}%, #D1D1D6 100%)`;
    slider.style.background = backgroundStyle;
    
    // 强制重绘
    slider.offsetWidth;
    
    console.log('Slider background updated:', backgroundStyle);
    updateDebugInfo();
}

// 更新城市列表
function updateCityList(userCity) {
    const citySet = new Set(['所有城市']);
    restaurants.forEach(r => citySet.add(formatCityName(r.city)));
    if (userCity) citySet.add(formatCityName(userCity));

    const cities = Array.from(citySet).sort();
    const citySelect = document.getElementById('city');
    citySelect.innerHTML = ''; // 清空现有选项
    cities.forEach(city => {
        const option = document.createElement('option');
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
    });
    console.log('City list updated. Available cities:', cities);
}

// 更新城市选择器
function updateCitySelect(city) {
    const citySelect = document.getElementById('city');
    const selectedCitySpan = document.querySelector('.selected-city');
    if (citySelect && selectedCitySpan) {
        const formattedCity = formatCityName(city);
        let matchFound = false;

        // 遍历所有选项,查找匹配的城市
        for (let i = 0; i < citySelect.options.length; i++) {
            const option = citySelect.options[i];
            if (compareCityNames(formatCityName(option.value), formattedCity)) {
                citySelect.value = option.value;
                selectedCitySpan.textContent = option.value;
                matchFound = true;
                break;
            }
        }

        // 如果没有找到匹配的城市,设置为"所有城市"
        if (!matchFound) {
            citySelect.value = '所有城市';
            selectedCitySpan.textContent = '所有城市';
        }
        
        updateDistanceFilterVisibility();
        updateRestaurantCount(); // 更新餐厅数量
    }
}

// 滤餐厅的通用函数
function filterRestaurants(maxDistance) {
    const selectedCity = formatCityName(document.querySelector('.selected-city').textContent);
    const filterContainer = document.querySelector('.distance-select');
    
    return restaurants.filter(r => {
        const cityMatch = selectedCity === '所有城市' || compareCityNames(formatCityName(r.city), selectedCity);
        
        if (filterContainer.style.display === 'none') {
            return cityMatch;
        }

        if (realDrivingMode) {
            const d = drivingDistances[r.name];
            return cityMatch && !!d && (d.duration / 60) <= maxDistance;
        }

        if (directDistance) {
            const restaurantDistance = directDistances.find(d => d.name === r.name)?.distance;
            return cityMatch && restaurantDistance && restaurantDistance <= maxDistance;
        } else {
            const timeColumn = `${nearestLocation}时间`;
            return cityMatch && parseInt(r[timeColumn]) <= maxDistance;
        }
    });
}

// 更新餐厅数量显示
function updateRestaurantCount() {
    const countElement = document.querySelector('#restaurant-count .number');
    const cityElement = document.querySelector('.selected-city');
    const slider = document.getElementById('distance');
    
    if (countElement && cityElement && slider) {
        const maxDistance = parseInt(slider.value); // 使用滑块的值作为最大距离
        const filteredRestaurants = filterRestaurants(maxDistance); // 调用过滤函数

        countElement.textContent = filteredRestaurants.length; // 更新餐厅数量
        console.log('Restaurant count updated:', filteredRestaurants.length, 'for city:', cityElement.textContent, 'within', maxDistance, 'km');
    } else {
        console.warn('Restaurant count, city element, or slider not found');
    }
}

// 随机选择餐厅
function selectRandomRestaurant() {
    const cityElement = document.querySelector('.selected-city');
    const slider = document.getElementById('distance');
    if (cityElement && slider && nearestLocation) {
        const maxDistance = parseInt(slider.value);
        const filteredRestaurants = filterRestaurants(maxDistance); // 调用过滤数

        if (filteredRestaurants.length === 0) {
            console.log('No restaurants available with current filters');
            return null;
        }

        const randomIndex = Math.floor(Math.random() * filteredRestaurants.length);
        const selectedRestaurant = filteredRestaurants[randomIndex];
        console.log('Randomly selected restaurant:', selectedRestaurant);
        return selectedRestaurant;
    } else {
        console.warn('City element, slider, or nearestLocation not found');
        return null;
    }
}

// 将URL转换为移动端友好的格式
function convertToMobileUrl(url) {
    if (!url) return '#';
    return url.replace('https://www.dianping.com/shop/', 'https://m.dianping.com/shopshare/');
}

// 辅助函数：格式化城市名称
function formatCityName(city) {
    if (!city) return '所有城市';
    city = Array.isArray(city) ? city[0] : city;
    return city.replace(/[\[\]]/g, '').trim(); // 只移除方括号和空白字符
}

// 新增函数：比较城市名称
function compareCityNames(name1, name2) {
    return name1.slice(0, 2) === name2.slice(0, 2);
}

// 新增函数：控制距离滑块的显示
function updateDistanceFilterVisibility() {
    console.log('Updating distance filter visibility');
    const filterContainer = document.querySelector('.distance-select');
    const selectedCity = formatCityName(document.querySelector('.selected-city').textContent);
    const slider = document.getElementById('distance');
    
    console.log('User city:', userCity);
    console.log('Selected city:', selectedCity);
    console.log('Direct distance:', directDistance);
    
    if (userPosition && userCity && compareCityNames(userCity, selectedCity)) {
        console.log('Showing distance filter');
        filterContainer.style.display = 'block';
        slider.value = directDistance ? String(DEFAULT_DISTANCE_KM) : "30";
        
        // 使用 setTimeout 确保在 DOM 更新后更新背景
        setTimeout(() => {
            updateSliderBackground(slider);
            updateTimeFilterUI(); // 更新滑块UI
        }, 0);
    } else {
        console.log('Hiding distance filter');
        filterContainer.style.display = 'none';
    }
    updateRestaurantCount(); // 更新餐厅数量
    updateDebugInfo();
}

// 修改 init 函数
function init() {
    initCount++;
    console.log('Initializing... Count:', initCount);
    
    // 初始化 DOM 元素引用
    loadingMessage = document.getElementById('loading-message');
    errorMessage = document.getElementById('error-message');
    restaurantCount = document.getElementById('restaurant-count');

    loadDefaultCSV();
    requestUserLocation();
    
    // 使用 setTimeout 来确保在其他异步操作完成后初始化块
    setTimeout(() => {
        const slider = document.getElementById('distance');
        if (slider) {
            console.log('Setting initial slider value');
            slider.value = directDistance ? String(DEFAULT_DISTANCE_KM) : "30";
            updateSliderBackground(slider);
            updateSlider();
            slider.oninput = updateSlider;
        }
        updateDebugInfo();
    }, 0);
    
    // 计算真实车程按钮
    document.getElementById('calc-real-driving')?.addEventListener('click', () => {
        showCalcRealDrivingButton(false);
        startRealDrivingPhase1();
    });

    // 停止计算车程按钮
    document.getElementById('driving-stop-btn')?.addEventListener('click', () => {
        drivingCalcAborted = true;
    });

    // 添加随机选择按钮的事件监听器
    const randomSelectButton = document.getElementById('random-select');
    if (randomSelectButton) {
        randomSelectButton.addEventListener('click', () => {
            const restaurant = selectRandomRestaurant();
            if (restaurant) {
                console.log('Selected restaurant:', restaurant);
                getRestaurantLocationAndCalculateDistance(restaurant);
            } else {
                console.log('No restaurant selected');
            }
        });
    }

    // 更新地址按钮的事件监听器
    const updateLocationButton = document.querySelector('.location-select button');
    if (updateLocationButton) {
        console.log('Adding click event listener to update location button');
        updateLocationButton.removeEventListener('click', searchLocation);
        updateLocationButton.addEventListener('click', searchLocation);
    } else {
        console.warn('Update location button not found');
    }

    // 移除输入框的所有事件监听器
    const locationInput = document.getElementById('location');
    if (locationInput) {
        console.log('Removing all event listeners from location input');
        locationInput.removeEventListener('keypress', searchLocation);
        locationInput.removeEventListener('focus', searchLocation);
        locationInput.removeEventListener('click', searchLocation);
        
        // 添加一个焦点事件监听器，仅用于调试
        locationInput.addEventListener('focus', () => {
            console.log('Location input focused');
        });
    } else {
        console.warn('Location input not found');
    }

    // 添加城市选择事件监听器
    const citySelect = document.getElementById('city');
    citySelect.addEventListener('change', function() {
        updateCitySelect(this.value);
        updateDistanceFilterVisibility();
    });

    // 初始化城市列表
    updateCityList();
    
    updateDebugInfo();

    // 在 init 函数中添加以下代码
    const clearHistoryButton = document.getElementById('clear-history');
    if (clearHistoryButton) {
        clearHistoryButton.addEventListener('click', clearHistory);
    }

    const uploadDataLink = document.getElementById('upload-data');
    if (uploadDataLink) {
        uploadDataLink.addEventListener('click', showUploadDataMessage);
    }

    // 初始化时隐藏距离滑块
    const filterContainer = document.querySelector('.distance-select');
    if (filterContainer) {
        filterContainer.style.display = 'none';
    }
}

// 添加清除历史记录的函数
function clearHistory() {
    const historyCards = document.getElementById('history-cards');
    if (historyCards) {
        historyCards.innerHTML = '';
    }
}

// 添加显示上传数据消息的函数
function showUploadDataMessage(event) {
    event.preventDefault();
    alert('如果你想用自己的收藏餐厅，需要给我你的大众点评账号名称，微信上发我~：myu221B \n 筛选里直线距离也可以改成真实的打车距离');
}

function addToHistory(restaurant, distance, duration, taxiCost) {
  const historyCards = document.getElementById('history-cards');
  const cardHtml = `
    <div class="history-card">
      <h3>${restaurant.name}</h3>
      <p>${restaurant.address}</p>
      <div class="favorite-time">已收藏 ${calculateDaysSinceFavorited(restaurant.time)} 天</div>
      <div class="distance-info">
        <div>
          <p>距离</p>
          <p>${distance ? Math.round(distance / 1000) + ' 公里' : '未知'}</p>
        </div>
        <div>
          <p>预计驾车时间</p>
          <p>${duration ? Math.round(duration / 60) + ' 分钟' : '未知'}</p>
        </div>
        <div>
          <p>预计打车费</p>
          <p>${taxiCost ? Math.round(taxiCost) + ' 元' : '未知'}</p>
        </div>
      </div>
      <a href="${restaurant.url}" target="_blank" class="dianping-link">去大众点评查看</a>
      <button class="delete-card" aria-label="删除">&times;</button>
    </div>
  `;
  
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = cardHtml;
  const card = tempDiv.firstElementChild;
  
  const deleteButton = card.querySelector('.delete-card');
  deleteButton.addEventListener('click', function() {
    card.remove();
  });
  
  historyCards.insertBefore(card, historyCards.firstChild);
}

function calculateDaysSinceFavorited(favoriteDate) {
    const today = new Date();
    const favDate = new Date(favoriteDate);
    const diffTime = Math.abs(today - favDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

function updateDebugInfo() {
    const slider = document.getElementById('distance');
    const debugSliderValue = document.getElementById('debug-slider-value');
    const debugDirectDistance = document.getElementById('debug-direct-distance');
    const debugSliderBackground = document.getElementById('debug-slider-background');
    const debugInitCount = document.getElementById('debug-init-count');

    if (slider) {
        if (debugSliderValue) debugSliderValue.textContent = slider.value;
        if (debugSliderBackground) debugSliderBackground.textContent = slider.style.background;
    }

    if (debugDirectDistance) debugDirectDistance.textContent = directDistance;
    if (debugInitCount) debugInitCount.textContent = initCount;

    console.log('Debug info updated:', {
        sliderValue: slider ? slider.value : 'N/A',
        directDistance,
        sliderBackground: slider ? slider.style.background : 'N/A',
        initCount
    });
}

// 当 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 在全局作用域添加一个计数器
let randomSelectionCount = 0;

// 修改 showRandomResult 函数
function showRandomResult(restaurant, distance, duration, taxiCost) {
    randomSelectionCount++; // 增加计数

    const totalRestaurants = filterRestaurants(parseInt(document.getElementById('distance').value)).length;
    const daysSinceFavorited = calculateDaysSinceFavorited(restaurant.time);
    
    let headerText;
    if (randomSelectionCount > 3) {
        headerText = '多试几次吧\n硬币落下时，心中会有答案';
    } else {
        headerText = `${totalRestaurants} 个餐厅中，\n这一家今天和你很有缘分！！`;
    }
    
    const overlay = document.getElementById('result-overlay');
    const header = document.getElementById('result-header');
    const content = document.getElementById('result-content');
    
    header.textContent = headerText;

    const template = document.getElementById('result-template');
    const card = template.content.cloneNode(true);

    const restaurantNameElement = card.querySelector('#restaurant-name');
    restaurantNameElement.textContent = restaurant.name;
    
    // 检查餐厅名称长度并添加适当的类
    if (restaurant.name.length > 4) {
        restaurantNameElement.classList.add('two-lines');
    } else {
        restaurantNameElement.classList.remove('two-lines');
    }

    card.querySelector('#restaurant-address').textContent = restaurant.address;

    const distanceElement = card.querySelector('#restaurant-distance');
    const durationElement = card.querySelector('#restaurant-duration');
    const costElement = card.querySelector('#restaurant-cost');
    const distanceInfoContainer = card.querySelector('.grid');

    if (distance && duration && taxiCost) {
        distanceElement.textContent = `${Math.round(distance / 1000)} 公里`;
        durationElement.textContent = `${Math.round(duration / 60)} 分钟`;
        costElement.textContent = `${Math.round(taxiCost)} 元`;
        distanceInfoContainer.style.display = 'grid';
    } else {
        distanceInfoContainer.style.display = 'none';
    }

    let favoriteTimeText = '';

    if (daysSinceFavorited >= 365) {
        const years = Math.floor(daysSinceFavorited / 365);
        const months = Math.floor((daysSinceFavorited % 365) / 30);
        favoriteTimeText = `已收藏 ${years}年${months > 0 ? months + '个月' : ''}`;
    } else if (daysSinceFavorited >= 30) {
        const months = Math.floor(daysSinceFavorited / 30);
        favoriteTimeText = `已收藏 ${months}个月`;
    } else {
        favoriteTimeText = `已收藏 ${daysSinceFavorited}天`;
    }

    card.querySelector('#restaurant-favorite-time').textContent = favoriteTimeText;
    card.querySelector('#restaurant-link').href = restaurant.url;

    content.innerHTML = ''; // 清空现有内容
    content.appendChild(card);
    
    // 添加这一行来将餐厅添加到历史记录
    addToHistory(restaurant, distance, duration, taxiCost);
    
    const tryAgainButton = document.getElementById('try-again');
    const viewHistoryButton = document.getElementById('view-history');

    // 移除旧的事件监听器
    tryAgainButton.removeEventListener('click', tryAgainHandler);
    viewHistoryButton.removeEventListener('click', viewHistoryHandler);

    // 添加新的事件监听器
    tryAgainButton.addEventListener('click', tryAgainHandler);
    viewHistoryButton.addEventListener('click', viewHistoryHandler);

    overlay.classList.remove('hidden');
}

// 将事件处理函数定义为单独的函数
function tryAgainHandler() {
    const overlay = document.getElementById('result-overlay');
    overlay.classList.add('hidden');
    // 不重置计数，因为这是继续尝试
    const newRestaurant = selectRandomRestaurant();
    if (newRestaurant) {
        getRestaurantLocationAndCalculateDistance(newRestaurant);
    }
}

function viewHistoryHandler() {
    const overlay = document.getElementById('result-overlay');
    overlay.classList.add('hidden');
    randomSelectionCount = 0; // 重置计数
    document.getElementById('history').scrollIntoView({ behavior: 'smooth' });
}

function initializeOverlay() {
    const overlay = document.getElementById('result-overlay');
    const resultContent = document.getElementById('result-content');
    const buttonContainer = document.querySelector('.button-container');
    overlay.classList.add('hidden');

    overlay.addEventListener('click', function(event) {
        if (event.target === overlay) {
            overlay.classList.add('hidden');
            randomSelectionCount = 0; // 重置计数
        }
    });

    // 阻止点击内容区域和按钮区域时关闭蒙层
    resultContent.addEventListener('click', function(event) {
        event.stopPropagation();
    });

    buttonContainer.addEventListener('click', function(event) {
        event.stopPropagation();
    });
}

// 在页面加载完成后调用初始化函数
document.addEventListener('DOMContentLoaded', initializeOverlay);