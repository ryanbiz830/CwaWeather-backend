require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 取得台北天氣預報 (原本的功能)
 * CWA 氣象資料開放平臺 API
 * 使用「一般天氣預報-今明 36 小時天氣預報」資料集
 */
const getTaipeiWeather = async (req, res) => {
  try {
    // 檢查是否有設定 API Key
    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 呼叫 CWA API - 一般天氣預報（36小時）
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: "臺北市",
        },
      }
    );

    // 取得台北市的天氣資料
    const locationData = response.data.records.location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: "無法取得台北市天氣資料",
      });
    }

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      updateTime: response.data.records.datasetDescription,
      forecasts: [],
    };

    // 解析天氣要素
    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
        windSpeed: "",
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx":
            forecast.weather = value.parameterName;
            break;
          case "PoP":
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT":
            forecast.minTemp = value.parameterName + "°C";
            break;
          case "MaxT":
            forecast.maxTemp = value.parameterName + "°C";
            break;
          case "CI":
            forecast.comfort = value.parameterName;
            break;
          case "WS":
            forecast.windSpeed = value.parameterName;
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    res.json({
      success: true,
      data: weatherData,
    });
  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

/**
 * [新增功能] 取得大同區天氣預報綜合描述
 * 使用「鄉鎮天氣預報-臺北市」資料集 (F-D0047-061)
 */
const getTaipeiWeatherDetail = async (req, res) => {
  try {
    if (!CWA_API_KEY) {
      return res.status(500).json({ error: "伺服器設定錯誤", message: "請設定 API Key" });
    }

    // 1. 呼叫 API (維持您原本參數，但在 JS 處理回應時要小心)
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-061`,
      {
        params: {
          Authorization: CWA_API_KEY,
          LocationName: "大同區",       // 這裡參數名稱大小寫沒關係，Axios 會處理
          ElementName: "天氣預報綜合描述",
        },
      }
    );

    const records = response.data.records;

    // 2. 修正：使用「大寫」Key 來檢查結構 (Locations vs locations)
    if (!records.Locations || records.Locations.length === 0) {
       return res.status(404).json({ error: "查無資料", message: "找不到 Locations" });
    }

    const cityData = records.Locations[0]; // 臺北市
    
    // 3. 修正：使用「大寫」Location
    const districtList = cityData.Location; 

    if (!districtList) {
        return res.status(404).json({ error: "查無資料", message: "找不到 Location 列表" });
    }

    // 4. 尋找大同區 (注意：API 回傳的是 LocationName，大寫 L)
    const districtData = districtList.find(d => d.LocationName === "大同區");

    if (!districtData) {
      return res.status(404).json({ 
          error: "查無此區", 
          message: "找不到大同區資料",
          available: districtList.map(d => d.LocationName) 
      });
    }

    // 5. 整理資料
    // 注意：WeatherElement, Time, ElementValue 全部都是大寫開頭
    const targetElement = districtData.WeatherElement.find(
      (el) => el.ElementName === "天氣預報綜合描述"
    );

    let currentForecast = null;

    if (targetElement && targetElement.Time) {
      const now = new Date();
      
      // 找出最接近現在的時間點
      const match = targetElement.Time.find((item) => {
        const start = new Date(item.StartTime); // 大寫 S
        const end = new Date(item.EndTime);     // 大寫 E
        return now >= start && now < end;
      });

      // 取得資料
      // 如果 match 存在用 match，否則用第一筆
      const validItem = match || targetElement.Time[0];

      if (validItem) {
          // ★★★ 關鍵修正 ★★★
          // 根據您的 JSON，值不在 .value，而是在 .WeatherDescription
          const desc = validItem.ElementValue[0].WeatherDescription; 
          
          currentForecast = {
            startTime: validItem.StartTime,
            endTime: validItem.EndTime,
            description: desc
          };
      }
    }

    res.json({
      success: true,
      data: {
        city: cityData.LocationsName,   // 臺北市
        district: districtData.LocationName, // 大同區
        forecast: currentForecast
      },
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "失敗", message: error.message });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      Taipei: "/api/weather/Taipei",
      TaipeiDetail: "/api/weather/TaipeiDetail", // 更新文件說明
      health: "/api/health",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 取得台北天氣預報 (原本路徑)
app.get("/api/weather/Taipei", getTaipeiWeather);

// [新增] 取得台北詳細天氣預報 (新路徑)
app.get("/api/weather/TaipeiDetail", getTaipeiWeatherDetail);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});