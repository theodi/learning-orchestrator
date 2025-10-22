// Application constants

export const API_ENDPOINTS = {
  FORECAST: {
    BASE_URL: "https://api.forecast.it/api",
    // Version mapping for different Forecast API types
    VERSION_MAP: {
      labels: "v1",
      projects: "v1", 
      tasks: "v3",
      persons: "v2"
    }
  },
  HUBSPOT: {
    BASE_URL: "https://api.hubapi.com",
    PORTAL_ID: process.env.HUBSPOT_PORTAL_ID || "748510",
  },
  MOODLE: {
    BASE_URL: process.env.MOODLE_URI || "https://moodle.learndata.info/webservice/rest/server.php",
    ROOT_URL: process.env.MOODLE_ROOT || "https://moodle.learndata.info",
  },
};

export const VALID_FORECAST_TYPES = ["labels", "projects", "tasks", "persons"];

export const CACHE_DURATION = {
  COMPANY_SEARCH: 1000 * 60 * 10, // 10 minutes
  CONTACT_SEARCH: 1000 * 60 * 10, // 10 minutes
};

export const HUBSPOT_CONFIG = {
  DEFAULT_PIPELINE_ID: process.env.HUBSPOT_DEFAULT_PIPELINE_ID || "660451504",
  DEFAULT_DEAL_STAGE_ID: "972052901",
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

export const DEBUG_MODE = {
  ENABLED: process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV === 'development',
  EMAIL_DEBUG: process.env.EMAIL_DEBUG === 'true',
};

// Helper function to get Forecast API URL for a specific type
export const getForecastApiUrl = (type) => {
  const version = API_ENDPOINTS.FORECAST.VERSION_MAP[type];
  if (!version) {
    throw new Error(`Invalid Forecast type: ${type}`);
  }
  return `${API_ENDPOINTS.FORECAST.BASE_URL}/${version}`;
};

export default {
  API_ENDPOINTS,
  VALID_FORECAST_TYPES,
  CACHE_DURATION,
  HUBSPOT_CONFIG,
  HTTP_STATUS,
  DEBUG_MODE,
  getForecastApiUrl,
};
