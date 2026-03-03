// distanceWorker.js

// 哈弗辛公式计算距离
function haversineDistance(lat1, lon1, lon2, lat2) {
    const R = 6371000; // 地球半径，单位为米
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // 返回距离，单位为米
}

// 处理来自主线程的消息
self.onmessage = function(event) {
    const { userPosition, restaurants } = event.data; // 获取用户位置和餐厅数据
    const distances = [];

    restaurants.forEach(restaurant => {
        if (restaurant['经纬度']) { // 确保经纬度存在
            const [lat, lng] = restaurant['经纬度'].split(',').map(Number); // 获取餐厅的经纬度
            const distanceInMeters = haversineDistance(userPosition.lat, userPosition.lng, lat, lng); // 计算直线距离
            const distanceInKilometers = Math.round(distanceInMeters / 1000); // 转换为千米并四舍五入
            distances.push({ 
                name: restaurant.name, 
                distance: distanceInKilometers,
                coordinates: { lat, lng } // 新增餐厅的经纬度
            }); 
        } else {
            console.warn(`Restaurant ${restaurant.name} does not have valid coordinates.`);
        }
    });

    // 将结果发送回主线程
    self.postMessage(distances);
    console.log("计算直线距离成功"); 
};
